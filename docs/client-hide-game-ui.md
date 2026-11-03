# 客户端说明：Android / iOS 隐藏游戏界面开关

> 更新时间：2026-11-03  
> 适用客户端：Android / iOS  
> 独立配置接口：`public/config/client.json`

## 1. 独立接口

该开关已经从总索引 `index.json` 完全拆出，不再放在分类 JSON 或总索引中。

主地址：

```text
https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/config/client.json
```

备用地址：

```text
https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/config/client.json
```

客户端应优先请求主地址，失败后再请求备用地址。

## 2. 响应格式

```json
{
  "schema_version": 1,
  "updated_at": "2026-11-03T09:27:26.440Z",
  "hide_game_ui": {
    "android": true,
    "ios": false
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema_version` | number | 当前固定为 `1` |
| `updated_at` | string/null | 客户端配置更新时间，ISO 8601 |
| `hide_game_ui.android` | boolean | Android 是否隐藏正常游戏界面 |
| `hide_game_ui.ios` | boolean | iOS 是否隐藏正常游戏界面 |

两个平台必须读取自己的字段：

```text
Android → hide_game_ui.android
iOS     → hide_game_ui.ios
```

不要读取另一个平台的值，也不要自行合并。

## 3. 客户端行为

```text
请求 client.json
    ↓
读取当前平台字段
    ↓
false / 缺失 / 无效
    → 正常展示游戏界面

true
    → 隐藏正常游戏界面
    → 展示客户端定义的目标页面
```

规则：

1. Android 只读 `hide_game_ui.android`；
2. iOS 只读 `hide_game_ui.ios`；
3. 当前平台字段缺失或不是布尔值时，按 `false` 处理；
4. 当前平台字段成功读取到 `true` 后，建议持久化最后状态；
5. 后续配置请求失败时，继续使用最后成功值，不要因为网络失败把 `true` 改成 `false`；
6. 从未成功读取过配置时，默认 `false`；
7. 该配置与 `index.json`、分类表版本完全独立；
8. 配置变化不会使分类 `updated_at` 变化，也不会要求重新下载分类表。

## 4. 请求方式

建议在 App 冷启动时独立请求一次，与索引请求互不阻塞：

```http
GET /config/client.json?t=<当前毫秒时间戳>
Cache-Control: no-cache
```

建议超时：

- 连接超时：4 秒
- 读取超时：5 秒
- 总超时：6 秒

请求失败后可使用 `gh-proxy.com` 备用地址。

## 5. 推荐本地状态

Android：

```text
last_hide_game_ui_android       Boolean
last_client_config_at_android   ISO 8601 / Unix 毫秒
```

iOS：

```text
lastHideGameUIiOS               Boolean
lastClientConfigAtiOS           ISO 8601 / Unix 毫秒
```

合并逻辑：

```text
请求配置成功：
    当前平台缓存 = 当前平台字段 == true

请求配置失败：
    当前平台缓存保持不变

从未请求成功：
    当前平台缓存 = false
```

## 6. Kotlin 数据模型

```kotlin
data class ClientConfig(
    @SerializedName("schema_version") val schemaVersion: Int,
    @SerializedName("updated_at") val updatedAt: String?,
    @SerializedName("hide_game_ui") val hideGameUi: PlatformFlags,
)

data class PlatformFlags(
    @SerializedName("android") val android: Boolean = false,
    @SerializedName("ios") val ios: Boolean = false,
)

fun ClientConfig.shouldHideGameUiForAndroid(): Boolean = hideGameUi.android
```

## 7. Swift 数据模型

```swift
struct ClientConfig: Decodable {
    let schemaVersion: Int
    let updatedAt: String?
    let hideGameUI: PlatformFlags?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case updatedAt = "updated_at"
        case hideGameUI = "hide_game_ui"
    }

    var shouldHideGameUI: Bool {
        hideGameUI?.ios == true
    }
}

struct PlatformFlags: Decodable {
    let android: Bool?
    let ios: Bool?
}
```

## 8. 验收用例

1. Android 为 `true`、iOS 为 `false`：只有 Android 隐藏；
2. Android 为 `false`、iOS 为 `true`：只有 iOS 隐藏；
3. 两者都为 `false`：两端均正常展示；
4. 两者都为 `true`：两端均隐藏；
5. `hide_game_ui` 缺失：两端均按 `false`；
6. Android 字段为字符串 `"true"`：Android 按 `false`；
7. 成功读取当前平台 `true` 后断网重启：保持隐藏；
8. 从未成功读取配置：默认正常展示；
9. 分类表 `updated_at` 未变化：配置请求不应触发分类表重新下载；
10. 旧客户端忽略新接口：不影响原有功能。

## 9. 与服务端其他接口的关系

```text
config.json            动态入口，解析 index.json 地址和备用地址
index.json             游戏仓库、分类 URL 和分类版本
config/client.json     Android / iOS 显示开关
catalog/*.json         各游戏类型列表
```

`client.json` 是独立配置文件，不与 `index.json` 或分类 JSON 混用。
