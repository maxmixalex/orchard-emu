# 原版 HP48gII 串口文件传输：修复与验证

## 当前范围与新增证据

UART0 非 FIFO 发送空缓冲区的 **level 中断**补齐后，原版 HP48gII 先完成串口对象上传和 GET；2026-10-22 的后续生产浏览器验证补齐了 **Receive、目录、FINISH 和同一连接复用**。文件 UI 现在为该机型开放 USB 与串口的这五项操作。这里验证的是内部功能 UART，不是物理计算器连线或真实波特率。

### 2026-10-22：五项操作及批量上传

[本轮汇总证据](evidence/file-workflows-r16.json) 固定六个生产资源、ROM、HOME 会话、上传对象及完整私有报告的 SHA-256。生产 WASM 仍为 `ce9f81ac…`，没有改变 CPU、UART 或按键时序。浏览器从 HOME 经物理按键进入串口 SERVER，顺序完成上传、GET、目录、FINISH；随后通过计算器原始 `SEND` 命令主动发送，再次进入 SERVER 并 GET。六个终态均是 `serial` / `complete`，三份实际浏览器下载的 37 字节对象正文均与原件相同，45 字节完整文件仅有头部 offset 7 的 C→B 差异。全程只有一次串口连接，无 USB 连接、页面/Worker 错误或 diagnostic stop。

第一次完整流程在上传、GET、目录和 FINISH 后暴露了界面问题：关闭后重开 Connections 会把目标重置为 USB，因此仍连接的串口 Receive 按钮不可用。原失败报告保留。连接选择现保存在 App 层，关闭窗口后仍保留；组件回归和上述完整生产浏览器重跑均通过。

另一条独立串口运行通过真实多文件选择器选中两份对象，分别上传为 `OR22A` / `OR22B`，逐个 GET 并实际下载，目录同时包含两项，FINISH 成功。同样的 USB 批次也通过，四份下载正文一致。每批 16 个文件/8 MiB 的上限由确定性测试覆盖，本次原版固件实测批次为两个文件。逐文件完成、失败、取消和未发送状态、完整批次预校验及复现命令见[文件传输](file-transfer.md#uploading-several-files)。

### 先前的 UART0 修复

根因对应一个具体硬件缺口：原版系统消费初始化包后启用了 TXD0 子中断，但旧核心从未产生该源。Samsung 手册规定 `UCON0[9]=1`、发送模式 `01`、非 FIFO 时，发送缓冲区为空应持续请求；屏蔽不阻止 pending 锁存，W1C 后条件仍在则重新触发。现有功能发送器立即把字节交给宿主队列，因此宿主尚未读取的字节不代表硬件发送缓冲区仍占用。实现与边界见[虚拟连接](virtual-link.md#current-functional-uart0)。

[汇总证据](evidence/serial-file-transfer-r14.json) 将直接协议验证与生产浏览器验证分开记录。首次修复验证使用以下旧 SERVER checkpoint、同一原版 ROM 和最终 Kermit 引擎，候选 WASM 为 `ce9f81ac640cbeeb1cd249d841d06ada633b6b36454ec29cd11cf39b2ddbc830`（97,726 字节）。上传 `OR14S` 和 GET 均完整结束；返回 45 字节，其中 37 字节对象正文与上传原件完全相同，只有传输头第 7 字节由 C 变为 B。全程输出 189 个 UART 字节，diagnostic stop 为 0。

该 checkpoint 来自原版 HOME 中实际按键执行 `CF(-33)`、`SF(-78)`、`SF(-35)`、`SERVER`，没有修改 guest 字段。新试验不覆盖旧失败文件，也不把协议层试验等同于完整 UI 验收。没有执行上传载荷、修改 ROM 或直接注入对象。功能 tick 记录不用于推导物理串口速度或输入延迟。

生产浏览器另从保存的 HOME 会话开始，经真实按键选择串口并进入 SERVER，连接 Serial，选择本地文件、上传、GET 并实际下载。两项终态均为 `complete` 且连接类型为 `serial`，45 字节返回文件的 37 字节对象正文一致。没有连接 USB，没有页面或 Worker 错误，最终计算器仍在运行。相同生产资源的 USB 上传、GET、目录和 FINISH 回归也全部通过；两条浏览器路径的资源哈希和独立报告身份都保留在汇总中。

串口浏览器的首个尝试未产生 Worker 快照或文件操作，失败截图再次超时并掩盖了更早的 UI 异常。该失败原件仍保留，原因未分类。验证工具随后改为优先保存原始异常、单列截图失败；另一次使用相同生产资源和输入的运行通过。这个诊断修正没有改变生产核心、协议或界面，成功报告没有覆盖失败记录。

## 39g+ 的定向功能回归

新增 UART 源也会在已准入 39g+ 的 `1+1`、APLET Library 和 Function START 输入中激活。三个冻结场景各做了一次[候选功能回放](evidence/uart-hp39-functional-r14.json)：原按键、固定运行终点、退休指令数和完整 LCD 输出均保持一致，UART 输出为空，stop 为 0，没有采集计时。

新 TXD0 pending 在屏蔽状态下正确锁存，因此真实 checkpoint 哈希发生变化。独立审查只在离线副本中清除该 bit 并重算 CRC，三个副本均恢复旧冻结哈希，确认其他所有序列化状态无差异；副本从未回灌 guest。这是这三个场景的外设功能回归，不是 `1+1` 或 APLET 的性能提升证据。

## 历史基线：消费初始化字节但没有回复

2026-10-21 的首次独立检查没有完成 UART0 文件上传。原版 HP48gII 固件已经进入串口 `SERVER`，宿主发送的初始化字节也被 guest 消费，但在有界检查内没有产生 UART 回复。完整上传在重试上限后明确超时，未进入 GET。在该基线下，文件 UI 保持关闭，底层 raw UART 仅供诊断。以下固定输入及失败记录原样保留；它们不是修复后生产版本的结果，也不是物理 HP48gII 不支持串口的结论。

USB 的成功往返不能替代这项串口反例，也不能用 UART 队列消费成功代替原版 Kermit 接受并保存了对象。

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

## 历史复现入口与后续范围

`tools/probe-stock-serial.mjs` 保留完整 SEND / GET 的独立诊断入口。需要用户本地持有的原版 ROM 和合法会话，不提供这些文件，也不自动下载。输出目录必须不存在；建议放在已经忽略的 `build-stock-serial/` 下。脚本记录输入、协议源、物理输入步骤、包元数据及成功条件，失败以非零退出码结束。

```sh
node tools/probe-stock-serial.mjs \
  /private/baseline.wasm /private/48gii.bin /private/home.ord \
  /private/OR49P.hp build-stock-serial/run-1 /private/protocol/file-transfer.js
```

最后一个路径应与同目录的 `kermit.js` 配套。要复现这里的精确失败，需使用上表相同的冻结协议文件；未提供时使用当前仓库版本。这个历史脚本固定要求旧基线 WASM，不会自动替换为修复后的核心。它不是自动化测试套件的一部分，也不用于墙钟性能比较。

修复后的完整浏览器路径使用 `tools/probe-file-transfer-browser.py --transport serial --expected-wasm SHA256 --start-server --server-commands --active-send`，并提供本地 ROM、HOME 会话、原创上传对象和新的输出目录。探针通过物理按键选择串口，再通过真实文件选择器、上传、GET、目录、FINISH、计算器主动 SEND 和再次 GET 验收；所有终态必须报告 `transport: serial`，且没有 USB 连接。显式 WASM 哈希不符时先拒绝，不会把新核心改标为旧基线。

Pulse 发送中断、FIFO 触发、UART1/2、物理线路和波特率时序仍不在本次补缺范围内。更大对象、计算器主动多文件 SEND、容量耗尽和线路故障恢复需各自的原版固件案例。上传成功也不意味着所有程序载荷均可执行，HP49 的头版本正规化不能掩盖正文差异。
