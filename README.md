# Hermix 发布后台

内部发布后台与本地配置仓库。公开游戏数据不在本仓库，存放在：

```text
https://github.com/zjinnova2027/hermixrom
```

## 目录

- `tools/game-publisher/`：本地发布网站、上传逻辑、Git 发布和分仓工具
- `publisher.config.json`：公开数据仓库、本地目录和游戏类型配置
- `docs/`：接口、服务端和 SSH 账户说明
- `docs/ssh-accounts/`：两个 GitHub 账户的公钥与用途记录

## 启动

```bash
cd tools/game-publisher
npm install
npm start
```

打开：

```text
http://127.0.0.1:4173
```

仓库管理和分类迁移页面：

```text
http://127.0.0.1:4173/repositories.html
```

## 公私分离

```text
hermixconfig  私有管理仓库：后台、配置、文档
hermixrom     公开数据仓库：index.json、分类 JSON、封面、ROM
```

当前 `publisher.config.json` 将公开数据目录配置为本地同级目录：

```text
../hermixrom
```

公开索引：

```text
https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/index.json
```

GitHub 代理备用地址：

```text
https://gh-proxy.com/https://raw.githubusercontent.com/zjinnova2027/hermixrom/main/public/catalog/index.json
```

## SSH

当前启用：

- `game_list_secondary` → `zjinnova2027`
- SSH Host：`github-game-secondary`

`Zjinnova2026` 对应密钥暂时保留，但当前不启用。
