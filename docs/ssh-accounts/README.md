# GitHub 分账户 SSH Key 记录

本项目需要两个 GitHub 账户。每个账户使用独立的 Ed25519 SSH Key，私钥只保存在本机 `~/.ssh/`，公钥放在本目录供复制到 GitHub。

## 账户与仓库分配

| Profile | GitHub 账户 | SSH Host 别名 | 目标仓库 | 验证状态 |
|---|---|---|---|---|
| `primary` | `Zjinnova2026` | `github-game-primary` | 暂不启用 | 备用，账户当前不可用 |
| `secondary` | `zjinnova2027` | `github-game-secondary` | `hermixconfig`、`hermixrom` | 当前启用；SSH 认证与 push 权限正常 |

## Primary Key

- 私钥：`~/.ssh/game_list_primary`
- 公钥：`docs/ssh-accounts/game-list-primary.pub`
- 类型：Ed25519
- 指纹：`SHA256:SCRSHPTFprbLtZOh0dhNhK+hK5Q62zUodhr4VTnxV80`
- 实际账户：`Zjinnova2026`
- 用途：总索引、MD、FC
- 当前状态：待处理 GitHub 账户异常

公钥内容：

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPFDTR4+cu+bJxk+DWiGdVNSuBuaV2AgJ00YwKnfGiSx game-list-primary
```

## Secondary Key

- 私钥：`~/.ssh/game_list_secondary`
- 公钥：`docs/ssh-accounts/game-list-secondary.pub`
- 类型：Ed25519
- 指纹：`SHA256:sZoxP4PcBRBeBK5jPESFhmjHUOPgGDtfyIqOWMziBfw`
- 实际账户：`zjinnova2027`
- 用途：发布后台配置、GBA、CPS1
- 当前状态：仓库已存在，push 权限已验证

公钥内容：

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII8+ardlEkzXKrbk2anDv7OuGCJC5XBUgu06yVX0YaRV game-list-secondary
```

## 本机 SSH 配置

`~/.ssh/config` 已加入两个独立 Host：

```sshconfig
Host github-game-primary
  HostName github.com
  User git
  IdentityFile ~/.ssh/game_list_primary
  IdentitiesOnly yes
  AddKeysToAgent no

Host github-game-secondary
  HostName github.com
  User git
  IdentityFile ~/.ssh/game_list_secondary
  IdentitiesOnly yes
  AddKeysToAgent no
```

对应 clone 地址形式：

```text
git@github-game-primary:Zjinnova2026/hermixconfig.git
git@github-game-primary:Zjinnova2026/hermixrom.git
git@github-game-secondary:zjinnova2027/hermixconfig.git
git@github-game-secondary:zjinnova2027/hermixrom.git
```

## 安全规则

- 不复制、不提交、不发送私钥内容。
- 私钥权限必须为 `600`。
- 只把本目录中的 `.pub` 公钥添加到 GitHub。
- 原有个人 Key `~/.ssh/id_rsa` 未修改，也没有用于本项目。
- 目标账户与仓库名已经记录；2026 账户恢复正常后再接入 `publisher.config.json` 并执行分仓迁移。
