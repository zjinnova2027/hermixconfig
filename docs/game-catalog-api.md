# Game List 公开接口文档

> 文档版本：`2026-10-26`
>
> 数据协议：`schema_version = 2`
>
> 适用客户端：Android / iOS

本文档面向 Android/iOS 客户端。客户端只读取 GitHub 上的公开 JSON 和静态文件，不需要访问本地发布后台，也不需要登录。

## 1. 基本地址

总库公开文件根目录：

```text
https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public
```

分类表、海报和 ROM 可以位于其他仓库；客户端应使用 `index.json` 中提供的完整分类 URL，不要假设所有文件都在总库。

入口索引（优先）：

```text
https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/index.json
```

GitHub 代理备用地址：

```text
https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/index.json
```

两种地址的文件目录结构完全一致。客户端建议先请求 GitHub Raw，超时或失败后再切换到 `gh-proxy.com` Raw 代理。当前仓库超过 jsDelivr 的 50MB 包限制，因此不再使用 jsDelivr。

仓库地址：

```text
https://github.com/zjinnova2027/hermixrom
```

## 2. 推荐的客户端读取流程

```text
GET catalog/index.json
    → 读取 catalogs[类型].url、fallback_url、updated_at 和 repository_url
    → 与本地缓存的分类表 updated_at 比较
    → 版本一致：直接使用本地分类表，不发起分类表请求
    → 版本不同：只 GET 发生变化的分类表
    → 展示 games 数组
    → 用户点击获取
    → 相对于分类表 URL 解析 rom_path
    → 用 file_size 和 sha256 校验文件
```

版本和仓库规则：

- `index.json.catalogs[类型].updated_at` 是该分类当前版本；
- 分类 JSON 顶层 `updated_at` 是同一版本；
- 两个字符串完全相等时，客户端不得重新下载该分类表；
- 分类可以位于不同 GitHub 仓库，必须使用索引中的完整 `url`，不能自行拼接总库地址；
- `repositories` 和 `catalogs[类型].repository_url` 可用于界面展示分类所属仓库。

当前类型：

- `GBA`
- `MD`
- `CPS1`
- `FC`

数据没有分页，每次直接返回该类型的完整列表。

## 3. 索引文件

地址：

```text
public/catalog/index.json
```

响应示例：

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
    },
    "gba-games": {
      "url": "https://github.com/example/gba-games",
      "branch": "main",
      "public_base_url": "https://raw.githubusercontent.com/example/gba-games/main/public",
      "fallback_public_base_url": null
    }
  },
  "catalogs": {
    "GBA": {
      "repository": "gba-games",
      "repository_url": "https://github.com/example/gba-games",
      "url": "https://raw.githubusercontent.com/example/gba-games/main/public/catalog/gba.json",
      "fallback_url": null,
      "updated_at": "2026-10-26T01:02:03.456Z"
    },
    "FC": {
      "repository": "gamelist",
      "repository_url": "https://github.com/zjinnova2027/hermixrom",
      "url": "https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/fc.json",
      "fallback_url": "https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/fc.json",
      "updated_at": "2026-10-26T04:05:06.789Z"
    }
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema_version` | number | 数据结构版本，当前固定为 `2` |
| `updated_at` | string/null | 所有分类中最新的更新时间，ISO 8601 毫秒精度 |
| `repositories` | object | 仓库 ID 到仓库地址和公开根地址的映射 |
| `catalogs` | object | 游戏类型到分类 URL、所属仓库和版本时间的映射 |

`catalogs[类型]` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `repository` | string | 仓库 ID |
| `repository_url` | string | GitHub 仓库地址 |
| `url` | string | 分类 JSON 的完整主地址 |
| `fallback_url` | string/null | 分类 JSON 的备用完整地址 |
| `updated_at` | string/null | 分类版本号，必须等于分类表顶层 `updated_at` |

分类可以位于任意已配置仓库。客户端必须直接使用 `url`，不能假设分类表和 `index.json` 位于同一仓库或同一目录。

## 4. 类型游戏列表

分类地址由 `index.json.catalogs[类型].url` 提供，可以是总库，也可以是独立仓库。

响应示例：

```json
{
  "schema_version": 2,
  "game_type": "GBA",
  "updated_at": "2026-10-22T10:30:02.824Z",
  "games": [
    {
      "id": "cps1-20261022-8aecf504",
      "name": "快打旋风",
      "name_en": "Final Fight",
      "cover_path": "../covers/cps1/cps1-20261022-8aecf504/cover.webp",
      "rom_path": "../roms/cps1/cps1-20261022-8aecf504/ffight.zip",
      "file_name": "ffight.zip",
      "file_size": 1407144,
      "sha256": "b37e25de503c39efddbb8eb2b9f7220f508c09a79c925bd8d428e03bffac6dbf",
      "revision": 3,
      "updated_at": "2026-10-23T07:06:28.491Z"
    }
  ]
}
```

### 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema_version` | number | 当前固定为 `2` |
| `game_type` | string | 当前列表的游戏类型 |
| `updated_at` | string/null | 列表最后更新时间，同时作为该分类版本号；ISO 8601 毫秒精度，空列表时可能为 `null` |
| `games` | array | 游戏数组；没有游戏时为空数组 |

### 游戏字段

| 字段 | 类型 | 可空 | 说明 |
|---|---|---|---|
| `id` | string | 否 | 稳定唯一 ID，不会因改名变化 |
| `name` | string | 否 | 中文显示名称，允许重复 |
| `name_en` | string | 否 | 英文显示名称，欧美语言环境应优先使用 |
| `cover_path` | string/null | 是 | 海报相对路径；没有上传海报时为 `null` |
| `rom_path` | string | 否 | 游戏包相对路径，文件可能是原始 ROM 或 `.zip` |
| `file_name` | string | 否 | 下载时使用的安全文件名。CPS1 必须使用 MAME 集合短名，例如 `punisher.zip`；其他类型使用稳定 ASCII 名称 |
| `file_size` | number | 否 | 发布的游戏包字节数；ZIP 包按 ZIP 文件本身计算 |
| `sha256` | string | 否 | 发布的游戏包 SHA-256；ZIP 包按 ZIP 文件本身计算，不是解压后文件 |
| `revision` | number | 否 | 记录修订号，从 `1` 开始；每次成功更新都会递增 |
| `updated_at` | string | 否 | 该游戏最后更新时间，ISO 8601 |

游戏条目本身不重复返回 `game_type`，客户端应使用所属列表的顶层 `game_type`。

客户端应根据系统语言选择显示名称：

- 英文或默认语言：优先使用 `name_en`
- 中文语言：使用 `name`

## 5. 相对路径解析规则

`cover_path` 和 `rom_path` 是相对于**类型 JSON 所在目录**的路径，不是相对于 `public/` 根目录。

示例：

```text
类型 JSON:
https://.../public/catalog/gba.json

rom_path:
../roms/gba/gba-20261022-9fdb7626/game.zip

最终地址:
https://.../public/roms/gba/gba-20261022-9fdb7626/game.zip
```

客户端应使用标准 URL 相对路径解析，不要手工删除或拼接 `../`。Android 可使用 `java.net.URI.resolve()` 解析相对地址。

## 6. 下载与校验

ROM 和海报均可公开下载，不需要 `Authorization`。

下载完成后建议校验：

1. 实际字节数等于 `file_size`；
2. 实际文件 SHA-256 等于 `sha256`；
3. 游戏包扩展名属于所属类型允许的范围。

允许的扩展名：

| 类型 | 允许的游戏包扩展名 |
|---|---|
| GBA | `.gba`, `.zip` |
| MD | `.md`, `.gen`, `.smd`, `.bin`, `.zip` |
| CPS1 | `.zip` |
| FC | `.nes`, `.fds`, `.unf`, `.zip` |

所有类型的游戏包都可以使用 `.zip`。上传时服务端会检查 ZIP 内的文件头和文件结构，确认内容与选择的游戏类型一致；内容不一致或包含多种类型时会被拒绝。

服务端不会解压或修改最终发布的 ZIP。客户端应直接下载 `rom_path` 指向的文件，并以列表顶层的 `game_type` 判断游戏类型，不能根据 `.zip` 后缀推断类型。若业务层要求未压缩 ROM，可在客户端下载并校验 ZIP 后自行解压。

下载落盘时使用 `file_name`，不要使用 `name`。`name` 是中文展示名，可能包含空格、括号等符号；`file_name` 保证符合 `^[A-Za-z0-9]+\.[A-Za-z0-9]+$`。

CPS1 的 `file_name` 不能随意修改，必须与 MAME 集合短名一致，例如：

```text
punisher.zip
knights.zip
sf2ce.zip
```

否则标准 MAME 无法按集合名找到 ROM。

校验失败时应删除临时文件，不要把它标记为已下载。

## 7. 已下载状态

“已下载”是客户端本地状态，不在服务端 JSON 中。

建议本地保存：

- `game.id`
- 本地 ROM 路径
- `sha256`
- `revision`
- 下载完成时间

判断游戏包是否变化时，以 `sha256` 为准；`sha256` 变化表示 ROM/ZIP 内容确实变化。

`revision` 每次成功更新都会递增，也可能只是名称或海报变化。因此：

- `sha256` 变化：提示游戏包已更新；
- 仅 `revision` 或 `updated_at` 变化：刷新名称、海报等元数据即可，不必重新下载游戏包。

## 8. 主地址与备用地址

每个仓库分别配置主公开地址和可选备用地址，并写入 `index.json.repositories`。每个分类在 `index.json.catalogs[类型]` 中提供：

- `url`：分类 JSON 主地址；
- `fallback_url`：分类 JSON 备用地址；
- `repository_url`：分类所属 GitHub 仓库。

示例：

```json
"GBA": {
  "repository": "gba-games",
  "repository_url": "https://github.com/example/gba-games",
  "url": "https://raw.githubusercontent.com/example/gba-games/main/public/catalog/gba.json",
  "fallback_url": "https://gh-proxy.com/https://raw.githubusercontent.com/example/gba-games/main/public/catalog/gba.json",
  "updated_at": "2026-10-26T01:02:03.456Z"
}
```

建议客户端：

1. 优先请求 `url`；
2. 连接超时、DNS 失败或 HTTP 5xx 时切换 `fallback_url`；
3. 下载 ROM 和海报时相对于实际分类 URL 解析 `rom_path` 和 `cover_path`；
4. 不通过字符串替换推导备用地址；
5. 主流程不依赖 GitHub API。

## 9. 缓存与刷新

公开文件可能受到网络和缓存影响。

建议：

- 启动或进入在线游戏页时只请求一次较小的 `index.json`；
- 本地缓存每张分类表的原文和顶层 `updated_at`；
- `catalogs[类型].updated_at == 本地分类表.updated_at` 时直接使用缓存，不请求分类表；
- 版本不一致时只请求 `catalogs[类型].url` 指向的分类表；
- 如果分类表与索引版本暂时不一致，可使用 `?v=<updated_at>` 绕过中间缓存后重试；
- 用户下拉刷新时重新检查索引，但版本相同的分类表仍不下载；
- 海报加载失败时显示本地默认封面；
- 不依赖 GitHub API 的分页或鉴权接口。

## 10. 错误与空数据

- 文件不存在时，GitHub Raw 通常返回 `404`。
- JSON 不存在或格式错误时，客户端应保留本地缓存并在下次刷新重试。
- `games` 为空数组表示该类型暂无游戏，不是接口失败。
- 当前接口没有服务端搜索、分页或排序参数。

## 11. 排序约定

新上传的游戏会插入到对应 `games` 数组的开头，因此客户端直接按数组顺序展示即可得到“最新上传在前”的效果。

## 12. 最小 Kotlin 数据模型参考

```kotlin
data class GameIndex(
    @SerializedName("schema_version") val schemaVersion: Int,
    @SerializedName("updated_at") val updatedAt: String?,
    val repositories: Map<String, GameRepository>,
    val catalogs: Map<String, GameCatalogInfo>,
)

data class GameRepository(
    val url: String,
    val branch: String,
    @SerializedName("public_base_url") val publicBaseUrl: String,
    @SerializedName("fallback_public_base_url") val fallbackPublicBaseUrl: String?,
)

data class GameCatalogInfo(
    val repository: String,
    @SerializedName("repository_url") val repositoryUrl: String,
    val url: String,
    @SerializedName("fallback_url") val fallbackUrl: String?,
    @SerializedName("updated_at") val updatedAt: String?,
)

data class GameCatalog(
    @SerializedName("schema_version") val schemaVersion: Int,
    @SerializedName("game_type") val gameType: String,
    @SerializedName("updated_at") val updatedAt: String?,
    val games: List<GameItem>,
)

data class GameItem(
    val id: String,
    val name: String,
    @SerializedName("name_en") val nameEn: String,
    @SerializedName("cover_path") val coverPath: String?,
    @SerializedName("rom_path") val romPath: String,
    @SerializedName("file_name") val fileName: String,
    @SerializedName("file_size") val fileSize: Long,
    val sha256: String,
    val revision: Int,
    @SerializedName("updated_at") val updatedAt: String,
)
```

## 13. 重要约束

- 公开文件全部可直接访问，没有鉴权。
- 游戏包最大 10MB（可直接上传 ZIP）。
- 海报为可选文件，支持 JPG、PNG、WebP。
- 当前数据格式版本为 `2`。
- 分类表可以位于不同 GitHub 仓库，客户端必须使用索引中的完整 URL。
- `catalogs[类型].updated_at` 必须与分类表顶层字段一致。
- 客户端应按分类版本跳过未变化列表。
- 仓库地址变化时，即使分类版本未变，也应刷新分类 URL 解析结果。
- 下载完成后必须按整个已发布文件校验 `file_size` 和 `sha256`。

## 14. 变更记录

### 2026-10-26

- 索引升级为 schema 2，支持总库和分类独立仓库。
- 索引使用 `repositories` 和 `catalogs`，分类 URL 改为完整地址。
- 分类记录所属仓库、仓库地址、主分类 URL、备用 URL 和毫秒级版本。
- 索引增加全局 `updated_at` 和分类级 `list_versions`。
- 分类版本使用分类表顶层毫秒级 `updated_at`，不再额外生成另一套版本号。
- 客户端按索引版本与本地分类版本比较，只下载发生变化的分类表。
- 发布端在同一次 Git commit 中提交分类表和索引。

### 2026-10-22

- 所有游戏类型支持 `.zip` 游戏包。
- 上传 ZIP 时会检查内部文件类型，防止类型选择错误。
- 客户端接口字段保持不变，`schema_version` 仍为 `1`。
- 明确 `sha256` 和 `file_size` 针对已发布的 ZIP 文件本身。
- `file_name` 改为仅包含英文字母、数字和扩展名的安全下载名。
- CPS1 的 `file_name` 固定使用 MAME 集合短名。
- 明确 `revision` 在每次更新时递增，ROM 是否变化应以 `sha256` 判断。
- 增加 GitHub Raw 与 jsDelivr 双地址策略。
- 游戏条目增加 `name_en` 英文字段。
- 中文和英文游戏名均移除末尾括号中的版本、日期和地区信息。
- 仓库超过 jsDelivr 50MB 限制后，备用线路改为 `gh-proxy.com`。
