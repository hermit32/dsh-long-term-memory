# tests/

三层测试，全部是纯 Node，不需要 DSH Host、不需要网络、不读真实记忆数据。

## 运行全部

```powershell
cd tests
.\run-all.ps1
```

退出码 0 = 全部通过。脚本会依次运行：

| 套件 | 命令 | 覆盖 |
| --- | --- | --- |
| memory | `node --test`（`plugins/memory`） | 存储、锁、摘要、属性归属、控制台、设置、鉴权、接线结构 |
| session-manager | `node --test`（`plugins/session-manager`） | 工作区归属、父链、模型工具隔离 |
| acceptance | `node --test`（`tests/`） | 发布声明本身：隔离、删除清理、鉴权、空 curator、精确 scrub |

> 验收套件里的 **Windows 路径作用域哈希** 用例只在 Windows 上执行；其他平台会跳过，
> 并改跑基于临时目录的可移植路径用例。原因见该文件顶部的注释和
> `../review/TEST_RESULTS.md`。

## 隐私扫描

```powershell
.\privacy-scan.ps1
```

扫描本包所有文本文件，只报告**文件、行号、类别**，不打印命中内容。命中即返回
非零。它覆盖通用类别（本机用户目录、工作区 ID、IM 标识、常见密钥前缀、私钥头、
手机号、邮箱、会话 UUID）。

它**不包含**本项目历史上用过的具体昵称/用户名——把这些字面量写进扫描脚本本身
就是泄露。发布者可以在本地用 `-ExtraPatterns @('...')` 补充自己的黑名单。

## 打包引用检查

```powershell
.\check-package-refs.ps1
```

检查每个 `package.json` 宣称存在的路径是否真的存在：`main`、`types`、`bin`、
`icon`、`exports`、`files` 以及 `dsh.bundle.patch`。缺失即返回非零。第二轮修复
（`session-manager` 的 `icon.svg`）可用它复验。

## 验收用例说明

`acceptance/isolation.test.mjs` 只依赖插件的零依赖模块，因此它的断言就是可以
被外部复算的“发布声明”：

1. 工作区 A、工作区 B 不等于私人工作区（含子目录、前缀同名、空配置）；
2. 作用域键按工作区区分，IM 与桌面同一路径共享（Windows 路径用例仅在 Windows
   执行；另有基于临时目录的可移植用例在所有平台执行）；
3. 删除会话只清 pending/owned，长期记忆条目不变；
4. 管理接口在没有 connection 服务时返回 503，401/403 原样拒绝；
5. curator 空批次是正常结果，不允许 delete，凭据内容被拒；
6. 修改一条记忆不会误删相似摘要行；paraphrase 不会被猜着删；
7. 结构性守卫：根会话判定、`assertPrivateExec`、`workspace`-only、工具隐藏、
   删除事件、两个管理路由都走统一认证、旧的不安全回退没有回来。
