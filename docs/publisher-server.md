# 本地游戏发布后台

本地网页后台支持“总库 + 分类仓库”的多仓库发布。`gamelist` 作为总库保存版本索引，每个游戏类型可以指向自己的 GitHub 仓库。

分类表的顶层 `updated_at` 同时作为该分类的版本号，使用毫秒精度 ISO 8601 时间。发布成功时：

- 分类仓库更新 `public/catalog/<类型>.json`、ROM 和海报；
- 总库更新 `public/catalog/index.json` 中的分类地址、仓库地址和 `updated_at`；
- 分类与总库是同一个仓库时只创建一个 Git commit；
- 分类使用独立仓库时，先提交并 push 分类仓库，再提交并 push 总库索引。

## 1. 仓库与公开目录

默认仓库：

- 总库：`https://github.com/zjinnova2027/hermixrom`
- 分支：`main`
- 公开目录：`public/`
- Git remote：`origin`

第一版 GBA / MD / CPS1 / FC 都指向总库。以后若 GBA 需要独立仓库，可增加类似配置：

```json
"repositories": {
  "gamelist": {
    "root": ".",
    "remote": "origin",
    "branch": "main",
    "contentRoot": "public",
    "githubUrl": "https://github.com/zjinnova2027/hermixrom",
    "publicBaseUrl": "https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public",
    "fallbackPublicBaseUrl": "https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public"
  },
  "gba": {
    "root": "../game_list_gba",
    "remote": "origin",
    "branch": "main",
    "contentRoot": "public",
    "githubUrl": "https://github.com/zjinnova2027/hermixrom_gba",
    "publicBaseUrl": "https://raw.githubusercontent.com/nannandedongdong/game_list_gba/main/public",
    "fallbackPublicBaseUrl": "https://gh-proxy.com/https://raw.githubusercontent.com/nannandedongdong/game_list_gba/main/public"
  }
}
```

然后把 GBA 的类型配置改成：

```json
"GBA": {
  "catalog": "gba.json",
  "extensions": [".gba", ".zip"],
  "repository": "gba"
}
```

总库只保存 `index.json`，分类仓库保存自己的列表、海报和 ROM。独立仓库目录必须是已经 clone 好的 Git 工作区。

总库 `index.json` 使用 schema 2：

```json
{
  "schema_version": 2,
  "updated_at": "2026-10-26T04:05:06.789Z",
  "repositories": {
    "gamelist": {
      "url": "https://github.com/zjinnova2027/hermixrom",
      "branch": "main",
      "public_base_url": "https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public",
      "fallback_public_base_url": "https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public"
    }
  },
  "catalogs": {
    "GBA": {
      "repository": "gamelist",
      "repository_url": "https://github.com/zjinnova2027/hermixrom",
      "url": "https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/gba.json",
      "fallback_url": "https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/gba.json",
      "updated_at": "2026-10-26T01:02:03.456Z"
    }
  }
}
```

一致性要求：

- `catalogs[类型].updated_at` 必须等于分类表顶层的 `updated_at`。
- `catalogs[类型].url` 是完整地址，客户端不再根据总库相对路径拼接。
- 发布器使用单调递增的毫秒时间，避免连续操作落在同一毫秒时版本不变。
- 分类独立仓库发布失败时，总库索引不会更新。
- 分类仓库 push 成功但总库索引 push 失败时，页面会明确提示失败仓库并允许重试。

## 2. 环境要求

- Node.js 20 或更高版本
- Git
- 当前用户拥有所有已配置仓库的 SSH 推送权限
- 每个仓库 remote `origin` 已配置为对应 GitHub 地址，例如：

```text
git@github-game-secondary:zjinnova2027/hermixrom.git
```

可以先验证权限：

```bash
git ls-remote --heads origin
```

## 3. 安装与启动

```bash
git clone git@github-game-secondary:zjinnova2027/hermixrom.git
cd game_list/tools/game-publisher
npm install
npm start
```

打开：

```text
http://127.0.0.1:4173
```

后台只监听本机回环地址，不对局域网或公网开放。

## 4. 配置

配置文件位于仓库根目录：

```text
publisher.config.json
```

主要配置项：

| 配置 | 说明 |
|---|---|
| `server.host` | 监听地址，默认 `127.0.0.1` |
| `server.port` | 本地端口，默认 `4173` |
| `mainRepository` | 总库仓库 ID，默认 `gamelist` |
| `repositories.<id>.root` | 本地 Git 工作区目录，相对于配置文件目录 |
| `repositories.<id>.remote` | Git remote，默认 `origin` |
| `repositories.<id>.branch` | 发布分支，默认 `main` |
| `repositories.<id>.contentRoot` | 公开文件目录，默认 `public` |
| `repositories.<id>.githubUrl` | 页面显示和索引使用的 GitHub 地址 |
| `repositories.<id>.publicBaseUrl` | 手机端优先访问的公开根地址 |
| `repositories.<id>.fallbackPublicBaseUrl` | GitHub 代理备用根地址 |
| `limits.romBytes` | 单个游戏包上限，默认 10MB；ZIP 按 ZIP 文件大小计算 |
| `limits.coverBytes` | 单海报上限，默认 2MB |
| `limits.zipMaxEntries` | ZIP 内文件数量上限，默认 2048 |
| `limits.zipMaxUncompressedBytes` | ZIP 解压后总大小上限，默认 128MB |
| `gameTypes.<类型>.repository` | 该分类使用的仓库 ID，默认总库 |
| `gameTypes` | 类型、JSON 文件名、允许的 ROM 扩展名 |

临时覆盖配置可使用环境变量：

```bash
GAME_PUBLISHER_REPO_ROOT=/path/to/repo \
GAME_PUBLISHER_CONFIG=/path/to/publisher.config.json \
npm start
```

## 5. 分类仓库迁移页面

页面地址：

```text
http://127.0.0.1:4173/repositories.html
```

页面用于把单个游戏类型从当前仓库迁移到另一个已经创建的 GitHub 仓库。

当前约束：

- 不自动创建 GitHub 仓库；
- 不支持合并已有分类数据；
- 一次只迁移一个游戏类型；
- 目标仓库中不能已有该类型的 catalog、covers 或 roms 数据；
- 迁移会批量复制分类 JSON、海报和 ROM；
- 新仓库验证成功后才更新总库索引；
- 索引切换成功后才清理旧仓库中的该分类数据。

页面流程：

1. 选择分类；
2. 输入新 GitHub 仓库地址和分支；
3. 自动 clone 或检查本地仓库；
4. 执行环境预检；
5. 展示文件数量、大小和迁移计划；
6. 批量复制并校验文件；
7. 提交并 push 分类仓库；
8. 更新总库 `index.json` 和 `publisher.config.json`；
9. 提交并 push 总库；
10. 删除旧仓库中的分类数据；
11. 显示完成结果。

迁移任务状态和日志保存在：

```text
.publisher/migrations/
```

该目录已加入 `.gitignore`，不会提交到游戏仓库。

失败处理：

- 预检失败时可在当前页面修改仓库地址后重新检查；
- 复制或 push 失败时任务进入“需要处理”；
- 旧数据和线上索引保持安全状态；
- 点击“从失败步骤继续”会复用已经完成的阶段；
- 新仓库尚未 push 时，可以放弃任务、清理目标仓库中的本次半成品并重新填写地址；
- 服务重启后仍可读取历史任务状态。

## 6. 发布规则

### 新增游戏

新增游戏必须填写中文名称和 English Name。选择 ROM / ZIP 后，中文游戏名称会自动填成文件名去掉最后一个扩展名的结果。例如：

```text
恐龙快打（世界版 930201） [dino].zip
→ 恐龙快打（世界版 930201） [dino]
```

如果游戏名称已经手动填写，则不会被自动覆盖。

游戏名称用于中文展示，可以包含符号；JSON 中的 `file_name` 由后台自动生成为安全下载名，只包含英文字母、数字和扩展名。

CPS1 是特例：上传的 ZIP 文件名必须是 MAME 集合短名，例如 `punisher.zip`、`knights.zip`。后台会用这个短名作为 `file_name` 和 ROM 存储文件名，不能用中文名或其他符号。

当前 CPS1 游戏库采用“ROM 锁定、封面可更新”策略：

- 新游戏上传类型中的 CPS1 显示为灰色，不能选择；
- 已有 CPS1 游戏可以进入“更新封面”；
- CPS1 的名称、ROM 和类型不可修改；
- 服务端拒绝新增 CPS1 游戏或替换 CPS1 ROM；
- CPS1 游戏仍可正常浏览和删除。

同一个仓库发布时，一次 commit 包含：

```text
public/roms/<类型>/<game-id>/game.<扩展名>
public/covers/<类型>/<game-id>/cover.<扩展名>   # 仅选择海报时
public/catalog/<类型>.json
public/catalog/index.json
```

分类使用独立仓库时产生两个 push：

1. 分类仓库：ROM、海报和 `<类型>.json`；
2. 总库：只更新 `index.json`。

### 更新游戏

页面选择已有游戏后，左侧会显示当前 ROM 的文件名、大小、SHA-256 和下载链接，并可以：

- 修改游戏名称；
- 不重新选择 ROM，直接保留当前 ROM；
- 选择新 ROM / ZIP 时替换当前游戏包；
- 可选替换海报；
- 不能修改游戏类型。

浏览器不允许把旧文件自动填回文件选择框，因此更新时 ROM 输入变为可选。没有选择新文件就保持原 ROM 不变。

替换 ROM 时不保留旧版本，直接覆盖固定路径。

任意成功更新都会让 `revision` 自动加 1，包括只修改名称或海报；客户端判断游戏包是否变化应比较 `sha256`。

只修改名称或海报、不上传新 ROM 时，本次 commit 只包含类型 JSON；如果还替换了海报，则同时包含海报文件。

### 删除游戏

点击“删除”后会先显示确认弹窗；确认后立即显示提交进度条。

删除操作在同一个 commit 中：

- 从类型 JSON 删除条目；
- 删除 ROM 目录；
- 如果存在海报，同时删除海报目录；
- push 到 GitHub。

没有海报的游戏不会因为不存在的海报路径而提交失败。若 push 失败，弹窗会提示并允许直接重试。

### 海报

海报不是必填项。未上传海报时，JSON 中：

```json
"cover_path": null
```

## 7. 校验规则

上传前会检查：

- 游戏名称非空且不超过 160 字符；
- 类型属于 GBA / MD / CPS1 / FC；
- 游戏包扩展名属于该类型允许范围；
- GBA / MD / FC / CPS1 均支持 `.zip` 游戏包；
- 游戏包不超过 10MB；
- 海报不超过 2MB；
- 海报必须是 JPG、PNG 或 WebP；
- 扩展名为 `.zip` 时，文件必须是有效 ZIP；
- ZIP 会被主动检查，GBA/MD/FC 通过文件头识别，CPS1 支持多文件街机包；
- ZIP 内容与所选类型不一致、混装多种类型、嵌套 ZIP、加密 ZIP 或异常路径会被拒绝；
- CPS1 ZIP 文件名必须是只含小写字母和数字的 MAME 集合短名；
- ZIP 解压后总体积和解压文件数量有安全上限；
- SHA-256 与已有 ROM 不重复；
- 发布时间文件不能已有未提交改动。

## 8. Git 行为

每次发布：

```text
git add -A -- <本次文件>
git commit -m "game: add/update/delete ..."
git push origin HEAD:main
```

发布前会：

1. 检查当前分支是否为 `main`；
2. 检查是否有别的暂存改动；
3. `git fetch origin main`；
4. 如远端有新提交，执行 `git pull --rebase --autostash`；
5. 检查本次目标文件是否有未提交改动。

如果 commit 成功但 push 失败，文件仍保存在本地，界面会提示“重试推送”。

## 9. 本地 API

后台自身的 API 只供本机网页调用。

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 服务状态和每个已配置仓库的 Git 状态 |
| `GET /api/config` | 当前配置和限制 |
| `GET /api/games` | 读取全部分类的游戏、版本和所属仓库 |
| `POST /api/games` | multipart 上传或更新游戏 |
| `DELETE /api/games/:id` | 删除游戏 |
| `POST /api/sync?repository=<id>` | 重试指定仓库的 push |
| `GET /api/repositories` | 仓库、分类路由和待处理迁移任务 |
| `POST /api/repositories/migrations/preflight` | 迁移前检查和文件统计 |
| `POST /api/repositories/migrations` | 启动单分类迁移任务 |
| `GET /api/repositories/migrations/:id` | 查询迁移进度和日志 |
| `POST /api/repositories/migrations/:id/retry` | 从失败步骤继续 |
| `POST /api/repositories/migrations/:id/cancel` | 放弃尚未 push 到新仓库的失败任务并重新填写 |

`GET /api/games` 返回：

```json
{
  "ok": true,
  "games": [],
  "catalog_versions": {
    "GBA": "2026-10-23T08:02:07.012Z",
    "MD": "2026-10-23T07:06:28.491Z",
    "CPS1": "2026-10-23T07:06:28.491Z",
    "FC": "2026-10-23T08:50:10.558Z"
  },
  "catalog_repositories": {
    "GBA": {
      "repository": "gamelist",
      "url": "https://github.com/zjinnova2027/hermixrom",
      "public_base_url": "https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public",
      "fallback_public_base_url": "https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public"
    }
  }
}
```

网页右侧“在线游戏”版本标签下方会显示当前分类的发布仓库地址。切换 GBA / MD / CPS1 / FC 时，版本时间和仓库地址会同步更新。

`POST /api/games` 的 multipart 字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 中文显示名称 |
| `name_en` | 新游戏必填；更新时可选 | 英文显示名称；更新时不传表示保留原值 |
| `game_type` | 新游戏必填 | GBA / MD / CPS1 / FC |
| `rom` | 新游戏必填；更新时可选 | ROM 或 ZIP 游戏包；更新时不传表示保留当前 ROM |
| `cover` | 否 | JPG / PNG / WebP |
| `id` | 更新时必填 | 已有游戏 ID |

上传 ZIP 时的成功响应会额外包含：

```json
{
  "package": {
    "format": "zip",
    "detected_type": "GBA",
    "detection": "file-header",
    "entry_count": 1,
    "uncompressed_size": 33554432
  }
}
```

更新但未重新选择 ROM 时：

```json
{
  "package": {
    "format": "zip",
    "preserved": true
  }
}
```

主要错误码：

| 错误码 | 说明 |
|---|---|
| `INVALID_ZIP` | ZIP 无法读取或格式错误 |
| `GAME_TYPE_MISMATCH` | ZIP 内容类型和页面选择不一致 |
| `MIXED_GAME_TYPES` | 同一个 ZIP 内混装多个游戏类型 |
| `UNRECOGNIZED_GAME_TYPE` | 未找到可识别的游戏文件 |
| `NESTED_ZIP` | ZIP 内嵌套了 ZIP |
| `ENCRYPTED_ZIP` | ZIP 加密 |
| `UNSAFE_ZIP_ENTRY` | ZIP 中包含异常路径 |
| `ZIP_TOO_MANY_ENTRIES` | ZIP 内文件数量超限 |
| `ZIP_UNCOMPRESSED_TOO_LARGE` | ZIP 解压后体积超限 |
| `DUPLICATE_ROM` | 相同 SHA-256 的游戏包已存在 |
| `PUSH_FAILED` | 本地 commit 成功，但 push 失败 |

## 10. 测试

```bash
cd tools/game-publisher
npm test
```

测试覆盖：

- 类型规范化；
- 游戏包大小和扩展名校验；
- GBA / MD / FC 的 ZIP 文件头识别；
- CPS1 多文件街机包；
- 类型不匹配、混装类型和无效 ZIP；
- 海报文件头识别；
- ID 与 SHA-256；
- 类型 JSON 与索引生成；
- 同仓库发布和多仓库 URL 生成；
- 双仓库测试：分类仓库保存 ROM/分类，总库只保存索引；
- GitHub 仓库地址解析；
- 仓库迁移页面使用的预检和任务状态接口；
- 分类资源地址解析。

## 11. 常见问题

### 推送失败

检查：

```bash
ssh -T git@github.com
git ls-remote --heads origin
```

修复后点击页面上的“重试推送”。

### 当前分支不是 main

```bash
git switch main
```

### 仓库有暂存改动

```bash
git status
```

先提交或取消暂存，再发布游戏。

### 远端有新提交且同步失败

```bash
git status
git pull --rebase --autostash origin main
```

处理冲突后重新发布。

### 分类仓库配置错误

检查：

- `repositories.<id>.root` 是否指向已经 clone 的 Git 工作区；
- remote、branch 和 GitHub 地址是否正确；
- 当前用户是否拥有该仓库的 push 权限；
- `gameTypes.<类型>.repository` 是否引用了存在的仓库 ID。

### 手机端还看到旧数据

GitHub Raw 可能有缓存。等待片刻，或在请求地址后加 `?v=<updated_at>`。

如果主地址网络不可用，可切换到配置中的 `gh-proxy.com` Raw 代理备用地址。当前仓库超过 jsDelivr 的 50MB 包限制，因此不再使用 jsDelivr。

## 12. 变更记录

### 2026-10-26

- 发布器支持“总库 + 分类独立仓库”的多仓库配置。
- `index.json` 升级为 schema 2，使用 `repositories` 和 `catalogs` 保存仓库地址、分类 URL 和版本。
- 发布后台“在线游戏”区域增加当前分类的发布仓库地址。
- 分类在独立仓库时先 push 分类仓库，再 push 总库索引。

### 2026-10-26（早期）

- 分类表 `updated_at` 作为毫秒级版本号。
- `index.json` 增加全局 `updated_at` 和分类级 `list_versions`。
- 分类表、索引和游戏文件在同一次 Git commit 中提交。

### 2026-10-22

- 支持 GBA / MD / FC / CPS1 上传 ZIP 游戏包。
- 增加 ZIP 内部类型识别和 ZIP 安全限制。
- 更新已有游戏时展示当前 ROM，并允许不重新选择 ROM。
- 单次新增、更新、删除仍只创建一个 Git commit。
- 删除操作增加确认弹窗、进度条和失败重试。
- 修复无海报游戏删除时 Git 提交路径不存在的问题。
- CPS1 下载文件名改为 MAME 集合短名。
- 游戏 JSON 增加 `name_en` 英文字段。
- 清理游戏名称末尾的括号版本信息。
- CPS1 入口锁定 ROM、中文名称和英文名称，只保留封面更新、浏览和删除能力。
