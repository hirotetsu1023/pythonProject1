/**
 * Google Chat → Markdown エクスポート【ミニマル版】
 *
 * Chat API のみ使用（スコープ1個・承認1回）。送信者はリソースID表記のまま。
 * まず確実に動かすことを優先した版。表示名も出したい場合はフル版を参照。
 */

const CONFIG = {
  SPACE_ID: 'spaces/AAQAy4I4rHE',   // 対象スペース
  START_TIME: null,                 // 例: '2026-01-01T00:00:00+09:00'（null = 全期間）
  END_TIME: null,                   // 例: '2026-01-31T23:59:59+09:00'
  PAGE_SIZE: 100,
  TIMEZONE: 'Asia/Tokyo',
  OUTPUT_FOLDER_ID: '',             // '' ならマイドライブ直下
};


/** 疎通確認: 先頭20件をログ出力（Drive出力なし）。まず最初にこれを実行して承認を通す。 */
function testListMessages() {
  const res = Chat.Spaces.Messages.list(CONFIG.SPACE_ID, { pageSize: 20 });
  if (!res.messages || res.messages.length === 0) {
    Logger.log('メッセージが見つかりません');
    return;
  }
  res.messages.forEach(function (m) {
    Logger.log('%s | %s', m.createTime, m.text || '(本文なし)');
  });
}


/** 本番: 期間フィルタ付きで全件取得 → Markdown化 → Driveに保存。 */
function exportChatToMarkdown() {
  const filter = buildTimeFilter_(CONFIG.START_TIME, CONFIG.END_TIME);
  const messages = listAllMessages_(CONFIG.SPACE_ID, filter);
  Logger.log('取得件数: %s', messages.length);

  const md = toMarkdown_(messages);
  const file = saveToDrive_(buildFileName_(), md);
  Logger.log('出力完了: %s', file.getUrl());
  return file.getUrl();
}


/** ページネーションで全件取得（createTime昇順）。 */
function listAllMessages_(spaceName, filter) {
  const out = [];
  let pageToken = null;
  do {
    const args = { pageSize: CONFIG.PAGE_SIZE, orderBy: 'createTime asc' };
    if (filter) args.filter = filter;
    if (pageToken) args.pageToken = pageToken;

    const res = Chat.Spaces.Messages.list(spaceName, args);
    if (res.messages) Array.prototype.push.apply(out, res.messages);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}


/** createTime フィルタ文字列を構築（両方nullならnull）。 */
function buildTimeFilter_(start, end) {
  const c = [];
  if (start) c.push('createTime > "' + start + '"');
  if (end) c.push('createTime < "' + end + '"');
  return c.length ? c.join(' AND ') : null;
}


/** メッセージ配列 → Markdown文字列。 */
function toMarkdown_(messages) {
  const lines = [];
  lines.push('# Google Chat エクスポート', '');
  lines.push('- スペース: `' + CONFIG.SPACE_ID + '`');
  lines.push('- 期間: ' + (CONFIG.START_TIME || '(指定なし)') + ' 〜 ' + (CONFIG.END_TIME || '(指定なし)'));
  lines.push('- 取得件数: ' + messages.length);
  lines.push('- 出力日時: ' + formatDate_(new Date().toISOString()), '', '---', '');

  messages.forEach(function (m) {
    const time = formatDate_(m.createTime);
    const sender = (m.sender && m.sender.name) || '(不明)';
    const body = (m.text || m.formattedText || '(本文なし)').trim();
    lines.push('### ' + time + ' — ' + sender, '', body, '', '---', '');
  });
  return lines.join('\n');
}


/** ISO文字列 → 'yyyy-MM-dd HH:mm:ss'。 */
function formatDate_(iso) {
  if (!iso) return '(日時なし)';
  return Utilities.formatDate(new Date(iso), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}


/** 出力ファイル名。 */
function buildFileName_() {
  const s = CONFIG.SPACE_ID.replace('spaces/', '');
  const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd_HHmmss');
  return 'chat_' + s + '_' + stamp + '.md';
}


/** Driveに保存。 */
function saveToDrive_(name, content) {
  const blob = Utilities.newBlob(content, 'text/markdown', name);
  return CONFIG.OUTPUT_FOLDER_ID
    ? DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID).createFile(blob)
    : DriveApp.createFile(blob);
}
