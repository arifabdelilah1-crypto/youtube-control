<?php
// Private store for final videos on the VDS (control.homerecipe.casa/media.php). Not part of web/: copied by hand.
// Every request carries a link signed with the shared secret (render/media.mjs, studio function):
//   PUT  ?p=videos/<id>.mp4&e=<expiry>&s=<hmac>&offset=N[&reset=1][&final=1&size=N&sha256=H]   upload in chunks
//   GET  ?p=videos/<id>.mp4&e=<expiry>&s=<hmac>[&dl=name]                                      play or download
// Thumbnails work the same way, as thumbs/<project id>-<8 hex>.jpg.
// Files live outside the web root; the secret too.
// This server drops Content-Length from PHP responses, and video players and Blotato need it. public_html/.htaccess restores it:
//   <Files "media.php">
//     Header set Content-Length "expr=%{resp:X-Media-Length}" "expr=-n %{resp:X-Media-Length}"
//     Header unset X-Media-Length
//   </Files>
declare(strict_types=1);

const STORE = '/home/controlapp/videos';
const SECRET_FILE = '/home/controlapp/.media-secret';
const MAX_BYTES = 5 * 1024 * 1024 * 1024;
const MIN_FREE_BYTES = 5 * 1024 * 1024 * 1024;  // never fill the disk the other sites and n8n share
const MAX_LINK_SECONDS = 8 * 86400;

function fail(int $code, string $message): void {
  http_response_code($code);
  header('Content-Type: text/plain; charset=utf-8');
  echo $message;
  exit;
}

// The dashboard uploads long videos straight from the browser (Long to Shorts): allow its origin.
const DASHBOARD_ORIGINS = ['https://arifabdelilah1-crypto.github.io'];
$origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
if (in_array($origin, DASHBOARD_ORIGINS, true)) {
  header("Access-Control-Allow-Origin: $origin");
  header('Vary: Origin');
  header('Access-Control-Allow-Methods: GET, PUT, HEAD, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, Range');
  header('Access-Control-Expose-Headers: X-Offset, Content-Length, Content-Range');
  header('Access-Control-Max-Age: 86400');
}
$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'OPTIONS') { http_response_code(204); exit; }
$signedMethod = $method === 'HEAD' ? 'GET' : $method;
if ($signedMethod !== 'GET' && $signedMethod !== 'PUT') fail(405, 'method not allowed');

$path = (string)($_GET['p'] ?? '');
$expiry = (int)($_GET['e'] ?? 0);
$signature = (string)($_GET['s'] ?? '');
if (!preg_match('#^(videos/[0-9a-f-]{36}\.mp4|thumbs/[0-9a-f-]{36}-[0-9a-f]{8}\.jpg)$#', $path)) fail(404, 'not found');

$secret = trim((string)@file_get_contents(SECRET_FILE));
if (strlen($secret) < 32) fail(503, 'store not set up');
$expected = hash_hmac('sha256', "$signedMethod\n$path\n$expiry", $secret);
if (!hash_equals($expected, $signature)) fail(403, 'bad link');
if ($expiry < time() || $expiry > time() + MAX_LINK_SECONDS) fail(403, 'link expired');

header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');
$file = STORE . '/' . basename($path);

if ($method === 'PUT') {
  $part = "$file.part";
  $free = disk_free_space(STORE);
  if ($free !== false && $free < MIN_FREE_BYTES) fail(507, 'disk almost full');
  $offset = (int)($_GET['offset'] ?? -1);
  $out = fopen($part, !empty($_GET['reset']) ? 'wb' : 'ab');
  if ($out === false || !flock($out, LOCK_EX)) fail(500, 'cannot open file');
  clearstatcache(true, $part);
  $have = (int)filesize($part);
  if ($offset !== $have) {
    header("X-Offset: $have");
    fail(409, 'wrong offset');
  }
  $in = fopen('php://input', 'rb');
  $written = stream_copy_to_stream($in, $out);
  fflush($out);
  flock($out, LOCK_UN);
  fclose($out);
  clearstatcache(true, $part);
  $have = (int)filesize($part);
  if ($written === false) fail(500, 'write failed');
  if ($have > MAX_BYTES) { unlink($part); fail(413, 'file too large'); }
  if (!empty($_GET['final'])) {
    if ($have !== (int)($_GET['size'] ?? -1)) fail(422, 'size mismatch');
    if (!hash_equals((string)($_GET['sha256'] ?? ''), (string)hash_file('sha256', $part))) { unlink($part); fail(422, 'checksum mismatch'); }
    chmod($part, 0640);
    rename($part, $file);
  }
  header('Content-Type: application/json');
  header("X-Offset: $have");
  echo json_encode(['offset' => $have]);
  exit;
}

if (!is_file($file)) fail(404, 'not found');
$size = (int)filesize($file);
$start = 0;
$end = $size - 1;
header('Accept-Ranges: bytes');
$isImage = str_ends_with($path, '.jpg');
header('Content-Type: ' . ($isImage ? 'image/jpeg' : 'video/mp4'));
header('Cache-Control: private, max-age=3600');
$name = preg_replace('/[^\w-]+/', '_', (string)($_GET['dl'] ?? ''));
if ($name !== '') header('Content-Disposition: attachment; filename="' . substr($name, 0, 80) . ($isImage ? '.jpg' : '.mp4') . '"');
if (preg_match('/^bytes=(\d*)-(\d*)$/', (string)($_SERVER['HTTP_RANGE'] ?? ''), $m) && ($m[1] !== '' || $m[2] !== '')) {
  if ($m[1] === '') { $start = max(0, $size - (int)$m[2]); }
  else { $start = (int)$m[1]; if ($m[2] !== '') $end = min((int)$m[2], $size - 1); }
  if ($start > $end || $start >= $size) { header("Content-Range: bytes */$size"); fail(416, 'bad range'); }
  http_response_code(206);
  header("Content-Range: bytes $start-$end/$size");
}
header('Content-Length: ' . ($end - $start + 1));
header('X-Media-Length: ' . ($end - $start + 1));
if ($method === 'HEAD') exit;
while (ob_get_level() > 0) ob_end_clean();
$in = fopen($file, 'rb');
fseek($in, $start);
$left = $end - $start + 1;
while ($left > 0 && !feof($in) && !connection_aborted()) {
  $chunk = fread($in, min(1048576, $left));
  if ($chunk === false) break;
  echo $chunk;
  flush();
  $left -= strlen($chunk);
}
