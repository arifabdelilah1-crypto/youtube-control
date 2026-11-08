<?php
// News headlines for one trending search, for the Trending page (control.homerecipe.casa/news.php). Not part of web/: copied by hand.
// Google News doesn't answer Supabase's servers, so the trending function asks this server, with a link signed like media.php:
//   GET ?q=<search>&gl=<country>&hl=<language>&e=<expiry>&s=<hmac of "GET\nnews:<q>|<gl>|<hl>\n<e>">
// Answers JSON: {"news": [{"title", "source", "url", "date"}]}, up to 5, cached one hour.
declare(strict_types=1);

const SECRET_FILE = '/home/controlapp/.media-secret';
const CACHE = '/home/controlapp/cache/news';
const CACHE_SECONDS = 3600;

function out(int $code, array $body): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('X-Robots-Tag: noindex');
  echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') out(405, ['error' => 'method not allowed']);
$q = trim((string)($_GET['q'] ?? ''));
$gl = strtoupper((string)($_GET['gl'] ?? 'US'));
$hl = strtolower((string)($_GET['hl'] ?? 'en'));
$expiry = (int)($_GET['e'] ?? 0);
$signature = (string)($_GET['s'] ?? '');
if ($q === '' || mb_strlen($q) > 200 || !preg_match('/^[A-Z]{2}$/', $gl) || !preg_match('/^[a-z]{2}$/', $hl)) out(400, ['error' => 'bad request']);

$secret = trim((string)@file_get_contents(SECRET_FILE));
if (strlen($secret) < 32) out(503, ['error' => 'not set up']);
$expected = hash_hmac('sha256', "GET\nnews:$q|$gl|$hl\n$expiry", $secret);
if (!hash_equals($expected, $signature)) out(403, ['error' => 'bad link']);
if ($expiry < time() || $expiry > time() + 600) out(403, ['error' => 'link expired']);

if (!is_dir(CACHE)) @mkdir(CACHE, 0700, true);
$file = CACHE . '/' . hash('sha256', "$q|$gl|$hl") . '.json';
if (is_file($file) && filemtime($file) > time() - CACHE_SECONDS) out(200, json_decode((string)file_get_contents($file), true) ?: ['news' => []]);

$url = 'https://news.google.com/rss/search?' . http_build_query(['q' => "$q when:3d", 'hl' => $hl, 'gl' => $gl, 'ceid' => "$gl:$hl"]);
$ctx = stream_context_create(['http' => ['timeout' => 12, 'header' => "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36\r\nAccept-Language: $hl\r\n"]]);
$xml = @file_get_contents($url, false, $ctx);
if ($xml === false) out(502, ['error' => 'Google News did not answer']);
$prev = libxml_use_internal_errors(true);
$rss = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NONET);
libxml_use_internal_errors($prev);
$news = [];
if ($rss && isset($rss->channel->item)) {
  foreach ($rss->channel->item as $item) {
    $source = trim((string)$item->source);
    $title = trim((string)$item->title);
    if ($source !== '' && str_ends_with($title, " - $source")) $title = substr($title, 0, -strlen(" - $source"));
    $news[] = ['title' => mb_substr($title, 0, 200), 'source' => mb_substr($source, 0, 80), 'url' => mb_substr(trim((string)$item->link), 0, 500),
               'date' => ($t = strtotime((string)$item->pubDate)) ? gmdate('c', $t) : null];
    if (count($news) >= 5) break;
  }
}
$body = ['news' => $news];
@file_put_contents($file, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
out(200, $body);
