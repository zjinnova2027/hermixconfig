# 客户端说明：隐藏游戏界面开关

> 更新时间：2026-11-03  
> 适用客户端：Android / iOS  
> 数据位置：总索引 `public/catalog/index.json`

## 1. 新字段

总索引新增一个顶层布尔字段：

```json
{
  "schema_version": 2,
  "updated_at": "2026-11-03T10:00:00.000Z",
  "hide_game_ui": false,
  "repositories": {},
  "catalogs": {}
}
```

字段说明：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `hide_game_ui` | boolean | `false` | `true` 时隐藏正常游戏界面，展示客户端定义的目标页面 |

字段位于 `index.json` 顶层，**不在分类 JSON 中**。

## 2. 客户端行为

```text
成功读取 index.json
    ↓
读取 hide_game_ui
    ↓
false / 缺失 / 类型错误
    → 正常展示游戏界面

true
    → 隐藏正常游戏界面
    → 展示客户端定义的目标页面
```

规则：

1. 每次成功解析 `index.json` 后更新本地开关状态；
2. 在渲染游戏界面前应用；
3. 字段缺失或不是布尔值时，按 `false` 处理；
4. 从未成功读取过该字段时，默认 `false`；
5. 成功读取到 `true` 后，建议持久化最后成功值；
6. 后续索引请求失败时，不要因为网络失败把已保存的 `true` 改成 `false`；
7. 旧版本客户端会忽略该字段，不需要强制升级；
8. 字段变化不会改变 `schema_version`，仍为 `2`。

## 3. 缓存和版本规则

- `hide_game_ui` 变化时，`index.json.updated_at` 会更新；
- `catalogs[类型].updated_at` 不会仅因这个开关变化而更新；
- 客户端仍然按分类的 `updated_at` 判断是否重新下载分类表；
- 不要把全局 `index.json.updated_at` 错当成某个分类的版本号；
- 只改变开关时，不需要重新下载 GBA、MD、CPS1、FC 分类 JSON。

## 4. 推荐本地状态

建议保存：

```text
last_hide_game_ui       Boolean
last_hide_game_ui_at    ISO 8601 / Unix 毫秒
```

合并逻辑：

```text
请求索引成功：
    last_hide_game_ui = index.hide_game_ui == true

请求索引失败：
    保持 last_hide_game_ui 不变

从未请求成功：
    last_hide_game_ui = false
```

## 5. Kotlin 数据模型

```kotlin
data class GameIndex(
    @SerializedName("schema_version") val schemaVersion: Int,
    @SerializedName("updated_at") val updatedAt: String?,
    @SerializedName("hide_game_ui") val hideGameUi: Boolean = false,
    val repositories: Map<String, GameRepository>,
    val catalogs: Map<String, GameCatalogInfo>,
)
```

## 6. Swift 数据模型

```swift
struct GameIndex: Decodable {
    let schemaVersion: Int
    let updatedAt: String?
    let hideGameUI: Bool?
    let repositories: [String: RepositoryIndexEntry]
    let catalogs: [String: CatalogIndexEntry]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case updatedAt = "updated_at"
        case hideGameUI = "hide_game_ui"
        case repositories
        case catalogs
    }

    var shouldHideGameUI: Bool {
        hideGameUI == true
    }
}
```

## 7. 验收用例

1. 索引为 `hide_game_ui: false`：正常展示游戏界面；
2. 索引为 `hide_game_ui: true`：隐藏游戏界面并展示目标页面；
3. 字段缺失：正常展示游戏界面；
4. 字段值为 `"true"` 字符串：按无效值处理，正常展示游戏界面；
5. 读取过 `true` 后断网重启：保持隐藏状态；
6. 从未读取过索引：默认正常展示；
7. 开关从 `false` 改为 `true`：分类表版本不变时不重新下载分类表；
8. 旧客户端收到新字段：不影响原有功能。

## 8. 注意

当前开关只控制客户端是否展示正常游戏界面。目标页面由各客户端自行定义；服务端不会下发页面 URL 或其他 UI 内容。
