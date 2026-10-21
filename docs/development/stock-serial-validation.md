# 原版 HP48gII 串口文件传输：当前验证结果

## 结论与范围

2026-10-21 的独立检查没有完成 UART0 文件上传。原版 HP48gII 固件已经进入串口 `SERVER`，宿主发送的初始化字节也被 guest 消费，但在有界检查内没有产生 UART 回复。完整上传在重试上限后明确超时，未进入 GET。因此当前用户界面不应开放串口文件上传 / GET；底层 raw UART 仍可保留供诊断。这是此模拟器与下列软件快照的结果，不是物理 HP48gII 不支持串口的结论。

USB 的成功往返不能补足此证据。也不能用“UART 队列消费成功”替代“原版 Kermit 接受并保存了对象”。本次没有运行计算器载荷、修改 ROM、直接改写 guest 标志或注入对象，也没有连接物理计算器。

## 固定输入与操作

| 输入 | SHA-256 |
| --- | --- |
| 基线 WASM | `76db5cb395cca4fffec807a76d3e969bf4cd73842662e39e81e38de4110527d0` |
| 已准入的 HP48gII 原版 NOR | `4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937` |
| 原版 HOME 的解码 checkpoint | `96e45b6d2188b2e0d8a2ed207bb430a5da36f9105a9be0f968ed0cd1c77cc69c` |
| 实际串口 SERVER checkpoint | `558b07e6f902fa09a44b725898ffec4750ab2b43f1d0e9c0b4b87de04853185b` |
| 45 字节原创 `OR49P.hp` | `0c0eb8d3aa56744ec2b72597356b190fad2b7d5e8387c79c7fccf8351028562b` |
| 冻结的 `kermit.js` | `a9f346aca3523ae88f0fea2b25b31fb8daaf6683c275adda5e454bbbb8342307` |
| 冻结的 `file-transfer.js` | `0c053b53561924b7ddc2d7b2c26143c08df0b06c62efa29b1db04166c753274f` |

协议文件在整个实验期间保持以上哈希；正在并行开发的 USB 修改没有混入此次运行。ROM、checkpoint、截图和原始诊断输出保留在本地忽略目录，没有加入仓库。

从原版 `hp48-home` 会话出发，通过真实键盘矩阵 / 专用键 API 输入 `CF(-33)`、`SF(-78)`、`SF(-35)`、`SERVER`。按下 600,000 ticks、松开 360,000 ticks；重复相同扫描码前额外松开 2,000,000 ticks。查看 LCD 确认标志表达式与 `Waiting Server Cmd.`，不是只根据按键序列推断状态。全程使用原版固件处理这些输入。

HP 官方 Advanced User's Reference，第二版，印刷页 C-2 / C-5，说明 -33 清除选择 USB / 串口，-78 在 -33 清除时对 48gII 选择串口（置位）或 USB（清除），-35 置位选择二进制对象传输。[官方手册](https://literature.hpcalc.org/official/hp50g-aur-en.pdf)

## 完整 SEND 的终态

串口 SERVER 就绪时为 tick **216,160,000**。尝试将原创 45 字节 HP49 程序作为 `OR13S` 上传；成功后才会 GET，其载荷不会被执行。

| 观测 | 结果 |
| --- | --- |
| 实际 SEND 运行量 | **300,001,280 ticks** |
| 结束 tick | **516,161,280** |
| 发出的 Kermit Send-Init | **5 包**；每包 16 wire bytes、序号 0 |
| 初始化发送 tick | 216,160,000；276,160,256；336,160,512；396,160,768；456,161,024 |
| 收到的 Kermit 包 / 文件 | **0 / 0** |
| SEND 终态 | `error`，重试耗尽并报告传输超时 |
| GET | 未执行 |
| core diagnostic stop | **0** |

不能从上述结果判断对象头或文件内容的兼容性，因为握手尚未完成。冻结版本的接收帧处理与后续生产版本可能不同；下面的单包检查直接统计 UART 输出字节，排除了“已经回复，只被该版本主机帧解析器拒绝”对该次观测的解释。

## 单个初始化包的消费检查

在上述真实 SERVER checkpoint 上另开一个实例，只发送 **1 个 16 字节 Send-Init**，不运行传输重试。通过现有 `checkpoint_save` 获取只读快照，按已定义的 v1 布局读取队列计数及 IRQ 状态；没有写入 checkpoint 字段。每个运行片段都经 `uart_receive()` 排空并计数宿主可见输出。检查限定为 **12,000,000 ticks**。

| 相对发送时刻 | UART0 RX 仍在队列的字节 | 累计读取的 TX 字节 | 额外观测 |
| --- | ---: | ---: | --- |
| 刚投递 | 16 | 0 | `uart_send()` 接收完整 16 字节 |
| +1 tick | 16 | 0 | UART0 子中断与主中断置位，CPU 进入 IRQ 向量 |
| +1,024 ticks | 4 | 0 | 已消费 12 字节 |
| +8,192 ticks | 0 | 0 | 16 字节全部消费，接收 IRQ 已清除 |
| +65,536 ticks | 0 | 0 | 没有输出 |
| +1,000,000 ticks | 0 | 0 | 没有输出 |
| +12,000,000 ticks | 0 | 0 | 正常运行，diagnostic stop 仍为 0 |

就绪快照中的 UART0 配置为 `ULCON0=0x3`、`UCON0=0x705`、`UFCON0=0`、`UBRDIV0=0x19`，UART0 主中断及 RXD0 子中断未屏蔽。队列 head 从 0 前进到 16，表明 guest 确实从接收寄存器取走数据；仍需定位数据进入固件接收逻辑之后为何没有回复。此时尚无证据足以归因于波特率、FIFO、帧间隔、IRQ 应答或 Kermit 参数中的任何单项。

## 复现入口与下一步

`tools/probe-stock-serial.mjs` 保留完整 SEND / GET 的独立诊断入口。需要用户本地持有的原版 ROM 和合法会话，不提供这些文件，也不自动下载。输出目录必须不存在；建议放在已经忽略的 `build-stock-serial/` 下。脚本记录输入、协议源、物理输入步骤、包元数据及成功条件，失败以非零退出码结束。

```sh
node tools/probe-stock-serial.mjs \
  /private/baseline.wasm /private/48gii.bin /private/home.ord \
  /private/OR49P.hp build-stock-serial/run-1 /private/protocol/file-transfer.js
```

最后一个路径应与同目录的 `kermit.js` 配套。要复现这里的精确结果，需使用上表相同的冻结协议文件；未提供时使用当前仓库版本。新的生产版本可能主动拒绝尚未验证的串口文件操作，脚本会如实记录失败，不绕过能力限制。此工具不是自动化测试套件的一部分，也不用于墙钟性能比较。

下一步应从“guest 已消费初始化字节，仍无 TX”这一边界继续查明具体原因，再做一个有限的修复后往返验证。不要通过重复整段超时或放宽上传成功条件来开启串口能力。开启前至少需要原版固件完成上传、按真实保存名称 GET，以及返回对象正文逐字节一致；HP49 的 `HPHP49-C` 到 `HPHP49-B` 头版本正规化可单独记录，不能掩盖正文差异。
