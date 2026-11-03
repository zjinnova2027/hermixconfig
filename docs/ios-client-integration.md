# Hermix iOS 在线游戏接入说明

> 更新时间：2026-10-27  
> 适用端：iOS 客户端  
> 在线数据协议：总索引 `schema_version = 2`，分类表 `schema_version = 1`

本文说明 Hermix iOS 应如何接入在线游戏列表。重点是最新增加的**动态入口配置**：客户端只需内置一个业务配置地址，以后主数据仓库变化时不需要重新发版。完整字段定义同时参见 [`game-catalog-api.md`](./game-catalog-api.md)。

## 1. 最终架构

在线游戏数据分成两个层次：

```text
固定动态配置地址
  https://d.zjinnova.com/hermix/gameconfig/config.json
        ↓ 返回主数据仓库地址
总索引 index.json
        ↓ 返回各分类表的完整 URL
GBA / MD / CPS1 / FC 分类 JSON
        ↓ 分类表内的相对路径
海报和 ROM
```

iOS 客户端的业务入口只需要依赖：

```text
https://d.zjinnova.com/hermix/gameconfig/config.json
```

代码中仍应保留一个内置的 `DEFAULT_INDEX_URL`，仅在“动态配置失败且本地没有历史成功地址”时使用，正常启动不应直接访问它：

```text
https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/index.json
```

所有公开文件均可直接访问，不需要登录、Token 或 GitHub API。

## 2. 动态配置接口

### 2.1 请求

```http
GET https://d.zjinnova.com/hermix/gameconfig/config.json?t=<当前毫秒时间戳>
Cache-Control: no-cache
```

建议超时：

- 连接超时：4 秒
- 读取超时：5 秒
- 总超时：6 秒

`?t=` 和 `Cache-Control: no-cache` 用于避免 CDN 或系统缓存返回旧仓库地址。

### 2.2 当前线上响应

```json
{
  "url": "https://github.com/zjinnova2027/hermixrom"
}
```

这里的 `url` 是 **GitHub 仓库地址**，不是 `index.json` 地址。客户端必须按第 2.3 节推导索引地址。

### 2.3 支持两种格式

推荐且当前使用的短格式：

```json
{
  "url": "https://github.com/zjinnova2027/hermixrom"
}
```

也兼容显式地址格式：

```json
{
  "index_url": "https://raw.githubusercontent.com/owner/repo/main/public/catalog/index.json",
  "fallback_index_url": "https://gh-proxy.com/https://raw.githubusercontent.com/owner/repo/main/public/catalog/index.json",
  "branch": "main",
  "content_root": "public"
}
```

字段说明：

| 字段 | 必填 | 默认值 | 说明 |
|---|---:|---|---|
| `index_url` | 否 | 无 | 完整索引地址，优先级最高 |
| `url` | 否 | 无 | GitHub 仓库地址；没有 `index_url` 时用它推导索引地址 |
| `fallback_index_url` | 否 | 自动生成 | 索引备用地址，必须为 HTTPS |
| `branch` | 否 | `main` | 仓库分支 |
| `content_root` | 否 | `public` | 公开文件根目录 |

`index_url` 和可推导的 `url` 至少要有一个；否则整份动态配置视为无效。

### 2.4 由仓库地址推导索引地址

对于标准地址：

```text
https://github.com/{owner}/{repo}
```

推导规则：

```text
https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{content_root}/catalog/index.json
```

当前默认值代入后：

```text
https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/index.json
```

实现细节：

1. 去掉仓库地址末尾的 `/`；
2. 去掉末尾的 `.git`；
3. `branch` 为空时使用 `main`；
4. `content_root` 为空时使用 `public`；
5. 如果显式传入的 `index_url` 是有效 HTTPS 地址，直接使用，不再推导；
6. 如果 `index_url` 无效但 `url` 有效，继续用 `url` 推导；
7. 如果显式 `fallback_index_url` 无效，则由主索引自动生成备用地址。

### 2.5 备用索引地址

如果动态配置没有提供 `fallback_index_url`，对 GitHub Raw 主索引自动生成：

```text
https://gh-proxy.com/<主索引完整地址>
```

当前值：

```text
https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/index.json
```

内置默认入口也必须同时准备主地址和备用地址：

```text
primary:  https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/index.json
fallback: https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/index.json
```

不要自行调用 GitHub API，也不要根据分类名硬编码仓库地址。

## 3. iOS 启动行为

### 3.1 调用时机

- App 冷启动后调用一次；
- 属于业务初始化，不需要用户点击；
- 请求在后台执行，不阻塞启动页或主界面；
- 同一个 App 进程内做 single-flight，只产生一个解析任务；
- 在线游戏页需要地址时 `await` 这个任务；
- App 从后台回到前台但进程未结束时，不必再次请求动态配置。

### 3.2 地址优先级

必须按以下顺序解析：

```text
1. 本次动态配置请求成功且格式有效
       ↓
   保存到本地，作为本次地址

2. 动态配置失败
       ↓
   使用本地保存的上次成功地址

3. 动态配置失败且本地无有效地址
       ↓
   使用代码内置 DEFAULT_INDEX_URL
```

动态配置成功后，应先持久化解析结果，再请求总索引。这样即使紧接着索引加载失败，下次启动也能使用刚刚获得的新地址。

### 3.3 本地持久化

iOS 建议使用 `UserDefaults`，不需要 Keychain，因为该配置不是敏感信息。

推荐使用以下键名（语义与 Android 保持一致）：

| Key | 类型 | 说明 |
|---|---|---|
| `game_catalog.index_url` | String | 当前主索引地址 |
| `game_catalog.fallback_index_url` | String | 当前备用索引地址 |
| `game_catalog.resolved_at` | Int64 | 解析成功时间，Unix 毫秒 |

只接受以 `https://` 开头的有效地址。动态配置请求失败、JSON 错误或地址为空时，不能覆盖之前的有效值。

### 3.4 日志要求

静默不等于无日志。建议统一使用 `[GameEndpoint]` 前缀记录：

```text
[GameEndpoint] resolving config: <config-url>
[GameEndpoint] config response repository=<repo> branch=<branch> contentRoot=<root>
[GameEndpoint] remote config saved: <index-url>
[GameEndpoint] remote config failed: <error>; checking saved/default
[GameEndpoint] using saved endpoint: <index-url> resolvedAt=<ms>
[GameEndpoint] using default endpoint: <index-url>
[GameEndpoint] resolved source=remote|saved|default elapsedMs=<ms>
[GameEndpoint] fetching index primary=<url> fallback=<url>
[GameEndpoint] index loaded via=<url>
```

### 3.5 Swift 解析流程参考

```swift
struct RemoteGameConfig: Decodable {
    let url: String?
    let indexURL: String?
    let fallbackIndexURL: String?
    let branch: String?
    let contentRoot: String?

    enum CodingKeys: String, CodingKey {
        case url
        case indexURL = "index_url"
        case fallbackIndexURL = "fallback_index_url"
        case branch
        case contentRoot = "content_root"
    }
}

struct ResolvedCatalogEndpoint {
    let indexURL: URL
    let fallbackIndexURL: URL?
    let source: String // remote / saved / default
}
```

伪代码：

```swift
func resolveEndpoint() async -> ResolvedCatalogEndpoint {
    do {
        let config = try await fetchRemoteConfig()
        let endpoint = try buildEndpoint(config, source: "remote")
        saveEndpoint(endpoint)
        return endpoint
    } catch {
        logger.warning("[GameEndpoint] remote config failed: \(error)")
        if let saved = loadSavedEndpoint() {
            return saved
        }
        return makeDefaultEndpoint()
    }
}
```

## 4. 总索引与分类表

### 4.1 获取总索引

先请求主索引，失败后再请求备用索引：

```text
primary:   endpoint.indexURL
fallback:  endpoint.fallbackIndexURL
```

总索引结构：

```json
{
  "schema_version": 2,
  "updated_at": "2026-10-26T06:47:25.434Z",
  "repositories": {
    "hermixrom": {
      "url": "https://github.com/zjinnova2027/hermixrom",
      "branch": "main",
      "public_base_url": "https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public",
      "fallback_public_base_url": "https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public"
    }
  },
  "catalogs": {
    "GBA": {
      "repository": "hermixrom",
      "repository_url": "https://github.com/zjinnova2027/hermixrom",
      "url": "https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/gba.json",
      "fallback_url": "https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/gba.json",
      "updated_at": "2026-10-23T08:02:07.012Z"
    }
  }
}
```

Android / iOS 显示开关不在 `index.json` 中，使用独立接口：

```text
https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/config/client.json
```

iOS 只读取：

```json
"hide_game_ui": {
  "android": false,
  "ios": true
}
```

中的 `hide_game_ui.ios`。该接口与索引、分类表版本完全独立，配置变化不会触发分类表重新下载。

详细客户端说明和 Swift 数据模型见 [`client-hide-game-ui.md`](./client-hide-game-ui.md)。

iOS 必须：

- 只处理 `schema_version == 2` 的索引；
- 从 `catalogs` 动态读取当前存在的分类，不假设永远只有四个；
- 使用 `catalogs[type].url` 的完整地址；
- 使用 `catalogs[type].fallback_url` 作为备用；
- 不自行拼接总库、分类仓库或分支地址；
- 将无法识别的分类安全忽略，不要让整页解析失败。

### 4.2 分类版本与缓存

每个分类有独立的毫秒级 ISO 8601 版本：

```text
index.catalogs[type].updated_at
分类表顶层 updated_at
```

规则：

1. 两个字符串完全相等时，直接使用本地分类缓存，不请求分类表；
2. 不相等时，只请求该分类表；
3. 请求分类表时建议追加 `?v=<updated_at>` 绕过中间缓存；
4. 分类表顶层 `updated_at` 与索引值不一致时，视为本次加载失败，保留旧缓存并稍后重试；
5. 分类表所在仓库地址、主 URL 或备用 URL 变化时，即使游戏内容没变，也应重新加载该分类。

建议缓存内容：

```text
分类 JSON 原文
分类主 URL
分类备用 URL
repository
repository_url
索引中的 updated_at
分类表自己的 updated_at
```

### 4.3 分类表结构

```json
{
  "schema_version": 1,
  "game_type": "MD",
  "updated_at": "2026-10-26T06:47:25.434Z",
  "games": [
    {
      "id": "md-20261026-a27e1aac",
      "name": "索尼克2",
      "name_en": "Sonic the Hedgehog 2",
      "cover_path": "../covers/md/md-20261026-a27e1aac/cover.webp",
      "rom_path": "../roms/md/md-20261026-a27e1aac/game.zip",
      "file_name": "md20261026a27e1aac.zip",
      "file_size": 750187,
      "sha256": "1eed42704bee1463d636ff00c787d7b1acf5c3e1348518b6fd10c8812c6c74f6",
      "revision": 1,
      "updated_at": "2026-10-26T06:35:59.784Z"
    }
  ]
}
```

显示名称：

- 中文系统：使用 `name`；
- 英文或其他语言：优先使用 `name_en`；
- `name_en` 为空时回退到 `name`。

数据无分页，数组顺序就是界面顺序；新游戏位于数组开头。

## 5. 海报和 ROM 地址解析

`cover_path`、`rom_path` 是相对于**分类 JSON 所在地址**的相对路径。

主资源地址必须使用实际成功加载分类表的 `url` 解析：

```swift
let coverURL = URL(string: game.coverPath!, relativeTo: primaryCatalogURL)?.absoluteURL
let romURL = URL(string: game.romPath, relativeTo: primaryCatalogURL)?.absoluteURL
```

不要手工删除或拼接 `../`。

备用地址注意：当前备用分类地址形如：

```text
https://gh-proxy.com/https://raw.githubusercontent.com/.../md.json
```

这种情况下，iOS 不要直接对代理 URL 套用相对路径。推荐逻辑：

1. 先相对主分类 URL 得到主资源完整 URL；
2. 如果备用分类 URL 的后缀等于主分类 URL，则将备用分类 URL 的前缀替换到主资源 URL 前；
3. 否则再相对备用分类 URL 解析。

示例：

```text
主分类:
https://raw.githubusercontent.com/.../public/catalog/md.json

主 ROM:
https://raw.githubusercontent.com/.../public/roms/md/<id>/game.zip

备用 ROM:
https://gh-proxy.com/https://raw.githubusercontent.com/.../public/roms/md/<id>/game.zip
```

海报不是必填项，`cover_path == null` 时显示本地默认封面。海报加载失败时不要清空游戏列表。

## 6. ROM 下载与校验

ROM 和 ZIP 均公开下载，不需要鉴权。

下载流程：

1. 使用主 ROM URL；
2. 请求失败时尝试备用 ROM URL；
3. 下载到临时文件；
4. 校验实际字节数等于 `file_size`；
5. 校验实际 SHA-256 等于 `sha256`；
6. 校验游戏包扩展名属于该类型允许范围；
7. 全部成功后再移到正式目录并标记为已下载；
8. 任一步失败都删除临时文件。

允许的扩展名：

| 类型 | 扩展名 |
|---|---|
| GBA | `.gba`, `.zip` |
| MD | `.md`, `.gen`, `.smd`, `.bin`, `.zip` |
| CPS1 | `.zip` |
| FC | `.nes`, `.fds`, `.unf`, `.zip` |

重要规则：

- 下载文件保存名使用 `file_name`，不要使用 `name`；
- `file_name` 只包含英文字母、数字和扩展名；
- CPS1 的 `file_name` 是 MAME 固定集合短名，例如 `punisher.zip`，不能改名；
- ZIP 的 `file_size` 和 `sha256` 针对 ZIP 文件本身，不是解压后的内部文件；
- 游戏类型使用分类表顶层的 `game_type`，不要根据 `.zip` 推断；
- 当前单个 ROM/ZIP 上限为 10MB。

“已下载”是客户端本地状态。建议保存 `id`、本地路径、`sha256`、`revision` 和下载时间。ROM 是否变化以 `sha256` 为准。

## 7. 错误与回退

| 场景 | 行为 |
|---|---|
| 动态配置超时、HTTP 错误、JSON 错误 | 使用上次成功地址；没有则使用内置默认索引 |
| 主索引失败 | 请求备用索引 |
| 某分类主地址失败 | 请求该分类的 `fallback_url` |
| 分类 JSON 损坏或版本不一致 | 保留旧缓存，不覆盖有效数据 |
| 某张海报失败 | 显示默认封面，不影响游戏列表 |
| ROM 下载校验失败 | 删除临时文件，允许用户重试 |
| `games` 为空 | 正常空列表，不是接口错误 |

始终保留上次可用数据，网络失败时不要把在线游戏页清空。

## 8. iOS 建议数据模型

```swift
struct GameIndex: Decodable {
    let schemaVersion: Int
    let updatedAt: String?
    let repositories: [String: RepositoryIndexEntry]
    let catalogs: [String: CatalogIndexEntry]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case updatedAt = "updated_at"
        case repositories
        case catalogs
    }
}

struct RepositoryIndexEntry: Decodable {
    let url: String
    let branch: String
    let publicBaseURL: String
    let fallbackPublicBaseURL: String?

    enum CodingKeys: String, CodingKey {
        case url, branch
        case publicBaseURL = "public_base_url"
        case fallbackPublicBaseURL = "fallback_public_base_url"
    }
}

struct CatalogIndexEntry: Decodable {
    let repository: String
    let repositoryURL: String
    let url: String
    let fallbackURL: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case repository
        case repositoryURL = "repository_url"
        case url
        case fallbackURL = "fallback_url"
        case updatedAt = "updated_at"
    }
}

struct GameCatalog: Decodable {
    let schemaVersion: Int
    let gameType: String
    let updatedAt: String?
    let games: [OnlineGame]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case gameType = "game_type"
        case updatedAt = "updated_at"
        case games
    }
}

struct OnlineGame: Decodable, Identifiable {
    let id: String
    let name: String
    let nameEN: String?
    let coverPath: String?
    let romPath: String
    let fileName: String
    let fileSize: Int64
    let sha256: String
    let revision: Int
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, sha256, revision
        case nameEN = "name_en"
        case coverPath = "cover_path"
        case romPath = "rom_path"
        case fileName = "file_name"
        case fileSize = "file_size"
        case updatedAt = "updated_at"
    }
}
```

## 9. iOS 验收用例

请至少验证以下场景：

1. **首次启动**：动态配置成功，解析出 `zjinnova2027/hermixrom` 索引并展示游戏；
2. **持久化**：成功后将 `index_url`、`fallback_index_url`、`resolved_at` 写入 UserDefaults；
3. **动态入口生效**：服务端配置换成另一个仓库后，删除 App 重装或重新冷启动，无需更新 App 即可使用新仓库；
4. **配置超时回退**：断网或让配置接口超时，App 使用上次成功地址；
5. **无缓存回退**：清除 UserDefaults 后断网，App 使用内置 `DEFAULT_INDEX_URL`；
6. **索引主备切换**：主索引不可用时可使用 `gh-proxy.com` 备用索引；
7. **分类增量加载**：分类 `updated_at` 未变化时不重复下载分类 JSON；
8. **分类迁移**：某分类 URL 指向其他仓库时，仍能正常加载该分类、海报和 ROM；
9. **英文名称**：非中文系统显示 `name_en`；
10. **下载校验**：ROM 下载后 `file_size` 与 `sha256` 均校验通过；
11. **版本一致性**：分类表与索引版本不一致时保留旧缓存并重试。

当前线上测试数据约为 442 款：

```text
GBA  100
MD   121
CPS1  38
FC   183
```

数量会随发布变化，仅用于测试核对，不要在 iOS 代码中写死。

## 10. 给 iOS 开发的最小结论

1. 固定业务入口只有 `https://d.zjinnova.com/hermix/gameconfig/config.json`；
2. 冷启动静默请求一次，做 single-flight，不阻塞 UI；
3. 成功先写 UserDefaults，再加载索引；
4. 失败优先用上次成功地址，最后才用内置默认索引；
5. 总索引只接受 `schema_version == 2`；
6. 分类 URL、分类仓库、备用地址全部以 JSON 为准，不能硬编码；
7. 分类版本相同就跳过下载，版本不同才刷新；
8. 海报和 ROM 用分类 JSON 的真实 URL 解析相对路径；
9. 英文系统显示 `name_en`；
10. ROM 下载后必须校验 `file_size` 和 `sha256`。
