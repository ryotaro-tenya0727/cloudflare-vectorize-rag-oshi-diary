# Cloudflare Vectorize + D1 + Workers AI RAG API スターター

GitHubのMarkdownを見出しごとに分割し、Vectorizeで意味検索してWorkers AIが日本語で回答する、小規模なPoC用スターターです。

- `/search`: 文書の意味検索
- `/ask`: 意味検索 + LLM回答
- `/admin/ingest`: 1ファイル登録・再登録
- `/admin/delete`: ファイル削除
- `/admin/paths`: 登録ファイル一覧
- `/health`: 疎通確認

**注意:** これはPoCです。社内文書はCloudflareに転送されます。利用前に社内のセキュリティ・データ取り扱いルールを確認してください。簡単なBearer token認証なので、本番はCloudflare Access/OIDC、権限別の文書フィルタ、監査ログ、ジョブ化などを追加してください。

## 1. 必要なもの

- Cloudflareアカウント
- Node.js、npm
- `docs/<カテゴリ>/*.md` のMarkdown。カテゴリは英数字、`-`、`_` 推奨。
- GitHub上にある該当文書の閲覧可能なURL（privateリポジトリのリンクでも可）

## 2. CLIを準備

```sh
npm install
npx wrangler login
```

## 3. Vectorizeを作成

日本語のEmbeddingに `@cf/baai/bge-m3` を使います。**1024次元**です。

```sh
npx wrangler vectorize create spec-index --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index spec-index --property-name=category --type=string
npx wrangler vectorize list-metadata-index spec-index
```

`category` のメタデータインデックスが作成されたことを確認してから登録してください。

## 4. D1を作成

```sh
npx wrangler d1 create spec-docs --location=apac
```

出力されるUUIDを `wrangler.jsonc` の `database_id` に設定します。

```sh
npx wrangler d1 execute spec-docs --remote --file=./schema.sql
```

> `wrangler.jsonc` の Vectorize / D1 / Workers AI のバインディングはあらかじめ記述済みです。

## 5. APIキーを設定してデプロイ

Macのターミナルで:

```sh
export API_KEY="$(openssl rand -hex 32)"
export WORKER_URL="" # デプロイ後に設定します
printf '%s' "$API_KEY" | npx wrangler secret put API_KEY
npx wrangler deploy
```

`wrangler deploy` に表示されるWorkerのURLを使います。

```sh
export WORKER_URL="https://internal-spec-rag.<your-subdomain>.workers.dev"
curl "$WORKER_URL/health"
```

APIキーは秘密です。ターミナル履歴、Git、共有チャットなどへ貼らないでください。

## 6. サンプルMarkdownを登録

このリポジトリには `docs/billing/cancellation.md` と `docs/accounts/permissions.md` という架空仕様のサンプルが入っています。最初の動作確認に使えます。

```sh
export DOCS_DIR="./docs"
export GITHUB_BLOB_BASE="https://github.com/YOUR_ORG/YOUR_REPO/blob/main/docs"
node scripts/ingest.mjs --sync
```

`GITHUB_BLOB_BASE` は出典リンクのURLです。最初は仮でも登録処理は動きますが、実運用では実際のGitHubリポジトリへ変更してください。

`--sync` は、Workers側に登録済みでローカルの `DOCS_DIR` に存在しないファイルを **削除** するため注意。PoC用の専用インデックスでのみ実行してください。

## 7. APIを試す

```sh
curl -s "$WORKER_URL/search" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"question":"退会時の請求はどうなる？","category":"billing"}'
```

```sh
curl -s "$WORKER_URL/ask" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"question":"退会時の請求はどうなる？","category":"billing"}'
```

`category` を省くと全カテゴリ横断で検索します。Vectorizeは結果が反映されるまで短い時間がかかることがあります。

## 8. 本物のGitHub Markdownを登録する

例: private GitHubリポジトリ `https://github.com/COMPANY/product-docs` に `docs/` ディレクトリがある場合。

```sh
# GitHubのアクセス許可のあるPCで
# このスターターのフォルダ外でも clone 可

git clone git@github.com:COMPANY/product-docs.git ./company-docs
export DOCS_DIR="./company-docs/docs"
export GITHUB_BLOB_BASE="https://github.com/COMPANY/product-docs/blob/main/docs"
node scripts/ingest.mjs --sync
```

このスクリプトはGitHub APIにはアクセスしません。ローカルにcloneしたMarkdownを読み、WorkerにHTTPS POSTします。既存の認証でprivate repoをcloneできれば、追加のGitHub PATは不要です。

**別のリポジトリで動かす場合**は、現在のPoC専用Vectorizeインデックスを使ってください。`--sync` は登録済みの全 `docs/` ファイルと同期するため、異なるリポジトリを順に同期すると前のリポジトリのデータを削除します。複数repo対応は次の改修として `repository` キーを追加してください。

## 9. GitHub Actionsで自動同期する（オプション）

`.github/workflows/index-docs.yml` と `scripts/ingest.mjs` をMarkdownが置かれているリポジトリにコピーします。

リポジトリの `Settings > Secrets and variables > Actions` から以下の2つのSecretsを追加:

- `WORKER_URL`: デプロイしたURL
- `WORKER_API_KEY`: API_KEYの値

`main` ブランチの `docs/**/*.md` の変更を検知して、Markdownを同期します。**変更されていないMarkdownは本文のSHA-256で判定してEmbeddingをスキップ**します。削除されたMarkdownも `--sync` で消します。

**費用・時間の観点から:** GitHub Actions側は全ファイルを送信しますが、Worker側で内容が不変ならEmbeddingをスキップします。大量データなら差分ファイルの送信とジョブキュー化も追加してください。

## 10. 高速化・精度向上の順序

1. まずはカテゴリをクライアントが指定し、検索する文書範囲を絞る（現状実装済み）
2. 既知の質問30件で正解チャンクがtop5に入るかを計測
3. D1の全文検索（FTS）と意味検索を組み合わせるハイブリッド検索を追加
4. 検索結果の再ランキングを追加
5. `/ask` をキャッシュし、繰り返し質問のAI推論を節約
6. 自動カテゴリ判定、階層メタデータの追加などを検討

## 運用・制約

- `MAX_DOC_CHARS=30000`、1ファイル最大40チャンクのPoC制限です。大きいMarkdownは分割してください。
- GitHubのMarkdownのうちH1/H2/H3で区切り、長い本文は約1200文字ごとに分割します。Markdownの複雑な構文（ネストしたコードフェンスなど）は完全には解析しません。
- カテゴリは `docs/<category>/...md` で決定します。`docs/foo.md` のようなカテゴリなしファイルはカテゴリ `foo.md` 扱いになるため推奨しません。
- Vectorizeの保存上限のFree枠は500万保存ベクトル次元、BGE-M3 (1024次元) で約4,882チャンク相当です。
- Worker無料枠、D1無料枠、Workers AIの日次無料枠があります。無料枠の上限に達するとエラーになる場合があります。
- 再登録時は旧チャンクを削除した後に登録しています。途中でエラーになると部分登録になり得ます。正確な同期、トランザクション相当の切り替えは本番で改善してください。
- APIは単一のBearerトークンを使い全ドキュメントを閲覧可能なPoCです。実際の社内利用ではユーザーと所属部門ごとのアクセス制御が必須です。
- `wrangler dev` はAI推論時にCloudflareへアクセスします。完全なオフラインでは動作しません。

## 公式情報

- https://developers.cloudflare.com/vectorize/get-started/embeddings/
- https://developers.cloudflare.com/vectorize/reference/metadata-filtering/
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers-ai/models/bge-m3/
- https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
