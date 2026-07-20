---
topic: ObsidianとClaude Codeの連携
tags:
  - claude
  - setup
---

# ObsidianとClaude Codeの連携

## ねらい

Claudeと話した内容をObsidianのノートとして残し、あとから振り返れるようにする。

## 仕組み

```
[iPhoneのObsidian] ──同期──> [GitHubリポジトリ(md群)] <──読み書き── [Claude Code]
```

- ObsidianのVaultをGitHubリポジトリにする
- iPhoneのObsidianは「Git」プラグインで同期
- Claude Codeは同じリポジトリを読み書きしてノートを作成・更新する

## セットアップ手順

1. GitHubに Private リポジトリ `obsidian-vault` を作成
2. Fine-grained PAT を発行（対象リポジトリ限定 / Contents: Read and write）
3. iPhoneのObsidianに「Git」プラグインをインストール・有効化
4. Authentication にユーザー名＋トークン、Remote URL を設定
5. Auto commit-and-sync（例：10分ごと）と Pull on startup をON
6. Claude Code側でそのリポジトリを開いて読み書き

## 注意点

- Claude Codeのコンテナは一時的。残す内容は必ずコミット＆プッシュ
- iOSのGitプラグインはVaultが巨大だと重くなることがある（最初は小さく始める）

## 関連

- [[daily/2026-07-20]]
