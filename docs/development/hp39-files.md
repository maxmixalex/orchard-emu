# HP39/40 文件服务、Wire 上传与格式

## 浏览器文件服务

`web/hp39-transfer.js` 为 39/40 系实现原创、有限内存的 Kermit 文件服务器。
计算器在 **Disk drive…** 模式中主动请求目录和文件，浏览器响应请求；
APLET、库、程序和笔记保持各自的 HP39 typed 封装。它通过原有 USB/UART
硬件输入输出传递字节，不直接写入计算器对象内存。

浏览器中打开 **连接 → 文件**，选择 ZIP 包，或同时选择对象文件和所需库，然后点击
**提供所选文件**。计算器中选择相应对象目录的 **RECV → Disk drive…**，
在远程列表中选取对象。若使用发布包，选择其 `HP39DIR.CUR`、`HP39DIR.000`
和被引用文件，也可直接选择整个 ZIP；文件名和目录别名保持原样。仅选择独立 typed 文件时，浏览器
自动创建内存中的目录。需传给计算器的文件在开始前全部读取、校验；任一
目录引用缺失、重复文件名、错误格式或超限都会阻止整个服务启动。
APLET 内部的运行时依赖由原系统请求，用户需同时选入其配套库；预检的引用
检查针对目录文件，不把封装识别提升为内部对象解析。

需要更快安装二进制 aplet 和库时，在 **计算器传输菜单** 中改选
**HP39/40 (Wire) — 快速上传**，仍选择同一个完整 ZIP，再点击 **通过 Wire 上传**。
浏览器先上传库；对当前显示的每一个文件，在计算器选择
**RECV → HP39/40 (Wire)**。一个文件收到最后的结束确认后，浏览器才会等待下一个
文件的 RECV。目录仅用于本机预检和选取原包内容，不作为 Wire 对象发送；
对象原始字节不会转换或改写。此模式发送所选包中的所有对象，不能像 Disk drive
那样只在计算器目录中选一个 aplet 并按需索取依赖。
上述菜单文字对应 HP39g+；HP39gs 的 USB 直传菜单为 **HP39/40 (USB)**，
串口为 **HP39/40 (Ser)**。页面按机型与连接显示对应提示，内部共用 Wire 发送器；
菜单文字不构成未验证连接的传输通过声明。

**传输时不限速**是可选开关，默认关闭。打开后，只有实际收发文件数据的阶段
临时使用 Unlimited；等待用户选择 RECV、选择远程目录以及两个 Wire 文件之间
仍保持原来的速度。完成、失败、取消、暂停或替换机器时自动恢复。传输中修改
速度会更新待恢复的用户选择；关闭这个开关会立即使用该选择。它不修改 CPU
时钟或 Normal 的默认值，虚拟时间超时仍按原协议工作。

Wire 的单文件错误会保留队列，显示具体失败文件及其错误；可以 **重试此文件**、
**跳过此文件** 或清空剩余队列。已取得最终 ACK 的对象不会因重试或跳过而再次
发送。每次重试和下一个文件都有新的请求编号，旧请求的延迟 ACK 不能推进新文件。
仍停在 RECV 的计算器先按 **ON**，等接收画面退出后，再为页面显示的当前文件重新打开
对应的 **RECV** 模式。库上传失败后若选择跳过，其依赖的 aplet 可能无法运行；
浏览器不会伪造已安装依赖。松散文件的读取/格式错误同样可以逐项处理，但整个 ZIP
或显式目录的缺失引用、CRC 错误等结构问题必须修复后重新选择，不会部分导入坏包。

Wire 当前只开放二进制 `B/C/D/H` 对象上传；ASCII 文件请使用 Disk drive。
实际原版系统见证覆盖 `B` aplet 和 `H` 库，`C/D` 的格式准入与协议单元测试
不替代它们各自的原版对象运行验证。Wire 上传取消后停止发送后续字节；若计算器
仍停在 RECV，请按计算器 **ON** 退出再试。已经完成的文件仍在计算器中。
当前没有验证向计算器发送 CAN 的远程取消流程，因此界面直接给出这个恢复步骤。

原版 39g+ 在 ON 中断后可能继续发送 CAN。新请求现在先等待自己的 D/C/NAK
握手，再将 CAN 解释为本次取消；此前的旧 CAN/ACK/EOT 尾流不会让重试立即失败。
处理不清空整个 USB/UART 输入，因此旧尾流同一包里的新握手仍会保留。
握手后的 CAN 仍立即报错，重复旧控制字节不延长两分钟初始等待上限。

反向传输使用 **接收计算器文件**，然后在计算器选择 **SEND → Disk drive…**。
每个文件只在完整 EOF、事务结束及最终 ACK 写入成功后出现下载按钮。
服务持续运行，可响应后续目录/对象请求；完成后点击 **停止文件服务**。
关闭连接、暂停/保存、替换 ROM 或恢复会话都会取消活动服务，并清除旧请求。
下载到浏览器的完整文件仍可手动保存。**下载完整包**将已接收的对象、库和目录
保存为可再次选择导入的 ZIP，也可解压后用于 Conn3x。原厂 SEND 返回
`HP39DIR.000` 而通常不返回 `HP39DIR.CUR`；导入和打包时会补齐这个固定目录入口，
原有目录别名与对象字节保持不变。跨事务同名文件以最近收到的版本写入包，
列表中的较早版本仍可单独下载。缺失依赖会报告具体文件名，不生成不完整的包。

| 路线 | 应用协议 | 验证范围 |
| --- | --- | --- |
| HP39g+ USB，Disk drive… | 主机 Kermit server / 计算器 client | 原版 D1.55 目录、APLET 和依赖库上传、SEND 回收与文件比较 |
| HP39gs USB，Disk drive… | 同一有限内存服务器 | r20 独立完整原 ROM 冷启、V2 aplet 与库安装、原生完整 ROM 读取后返回 HOME 和复用 stock USB；另有直传安装后的 SEND 回收核对；见 [39gs 启动证据](hp39gs-startup.md) |
| HP39gs 串口 / HP40gs USB 或串口，Disk drive… | 同一有限内存服务器 | 协议与适配器回归；本表不宣称这些连接的各机型原 ROM 端到端通过 |
| HP39g+ 串口 | 不开放文件能力 | 此机型没有 39gs/40gs 的有线串口；保留原始数据诊断 |
| HP39g+ USB，HP39/40 (Wire) | 原生分块上传，逐块及 EOT 确认 | r19 在 Normal 下安装原 ZIP 并回收；r20 同机真实 ON 中断、重试、跳过、任意后缀重选及数据阶段 Unlimited 后回收核对；见 [r20 传输证据](evidence/hp39-transfer-r20.json) |
| HP39gs USB，HP39/40 (USB) | 同一有界发送器 | r20 独立完整 2.22 NOR 冷启、库与 V2 aplet 完成确认、SEND 回收字节核对、原生 START 后返回 HOME；见 [39gs 启动证据](hp39gs-startup.md) |
| HP39gs 串口 / HP40gs USB 或串口，直传 | 同一有界发送器 | 尚无这些机型/连接的原 ROM 或真机端到端见证 |
| HP39/40 (Wire) 下载 | 尚未开放 | 从计算器下载仍选择 SEND → Disk drive… |

每次选择最多 16 个对象及其两个目录文件、总共 8 MiB、每文件最多 2 MiB。自动目录计入总字节
上限。主机 basename 限制为 64 个 ASCII 字节，拒绝
路径、大小写重复、保留设备名和尾随句点。服务最多运行 15 分钟虚拟时间，
活动 Kermit 事务仍有重试与超时限制；这些均不是实机速度承诺。

文件选择器没有后缀过滤。实际内容为 ZIP 时按 ZIP 导入，实际内容为 HP39 typed
对象时按其封装识别；改名为 `.data` 的 ZIP、没有后缀的库、后缀恰为 `.zip`
的 typed 对象不会因名称被误判。后缀不受限不等于跳过格式、大小或文件名安全检查。

ZIP 导入按 PKWARE ZIP 格式和浏览器 Compression Streams 标准接受 stored 和 DEFLATE 文件，[10][11]
压缩包上限 32 MiB、目录记录上限
1024 项，解压后的对象仍遵守上述限制。优先读取发布包的 `calculator/` 目录，
其次读取根目录或唯一 HP39 目录。有显式目录时，只解压目录及其明确引用的文件；
没有目录时，在同一选定目录中按解压大小和总量上限读取普通文件，以 HP39 typed
文件头识别对象，未知后缀同样参与识别。README、接收器 EXE、源码和 `test/`
对照导出不会成为计算器对象。路径遍历和重复项会阻止导入；
选中的计算器文件若有加密、符号链接、CRC 或长度不匹配，同样会被拒绝。解压在本机进行，取消或更换机器后
不会继续启动传输。ZIP64 和多卷包不支持；此时可解压并选择计算器文件。

`web/hp39-files.js` 仍可独立检查目录、ASCII/二进制标题和完整引用集合：

```sh
# 查看单个文件的类型、标题长度、载荷位置和 SHA-256
node tools/hp39-file-info.mjs /private/APLET.000

# 只检查明确指定的这几个文件，不递归扫描目录
node tools/hp39-file-info.mjs --bundle \
  /private/HP39DIR.CUR /private/HP39DIR.000 /private/APLET.000

# 无 ROM 测试
node tests/hp39-files.mjs
```

文件检查验证封装和引用关系，不解释或执行内部对象。普通对象返回
`payloadValidated: false`。只读检查器本身不启动上传，因而其 `uploadEnabled`
仍为 false；实际传输由独立服务器和用户所选对象决定。39g+ 的传输证据也
不代替其他机型的完整原生启动验证。r20 的 39gs 独立见证采用该机自身的完整 ROM，
其范围与这里的 39g+ Wire 见证分别记录。

### 支持范围与格式事实

HP39 使用自身的 typed file 封装，不能把 HP48/49 的 `HPHP49-C` 头直接当作 HP39 文件。现有作者的 aplet 生成说明给出了 `HP39BinB`、单字节名称长度和名称正文，随后才是 aplet 对象；同一作者的发布文件给出了目录的计数字段。独立的原始发布包也包含 `HP39BinH` 库文件与 `HP39AscA` 目录。[1][2]

| 文件头 | 当前解释 | 检查深度 |
| --- | --- | --- |
| `HP39AscA` | 目录列表 | 完整解析条目、计数字段和文件引用 |
| `HP39BinB` / `HP39AscB` | aplet | 只检查通用名称封装，载荷不解释 |
| `HP39BinC` / `HP39AscC` | 笔记 | 同上，不假定笔记正文是 UTF-8 |
| `HP39BinD` / `HP39AscD` | 程序 | 同上，不编译或执行 HP BASIC / SysRPL |
| `HP39BinH` / `HP39AscH` | 库 | 同上，不安装或执行库 |
| 类型字母 `E/F/G/I/J/K` | 保留原始字母 | 只识别通用封装，不推断对象语义 |
| `HP39BinA`、其他家族、其他类型字母 | 未支持 | 明确拒绝，不按普通对象猜测目录结构 |

ASCII 笔记和程序的长度前缀也可见于各自作者的源文件。显示名不是主机文件名；例如 `NOTE0.000` 可以在计算器上显示为 `First note`。这种区别必须保留。[3][4]

目录示例是本项目自行编写的测试数据：

```text
HP39AscA C 9 NOTE0.00010 First noteD 10 PROBE0.0005 Probe
```

每条记录由类型字母、文件名的十进制**字节数**、一个空格、该数量的文件名字节、标题字节数、一个空格和标题字节组成。记录可以紧接着下一条，不依赖换行。结构字段间接受空格、制表符和 CR/LF；数字之后只消费一个分隔空格，因此标题前导空格不会丢失。二进制文件的名称长度是一个原始字节。标题使用逐字节 Latin-1 显示以保留原值，不声称实现了 HP 字符集到 Unicode 的转换，也不会按 UTF-8 字符数重写长度。

当前宿主策略限制每个文件不超过 2 MiB、每次检查不超过 16 MiB、目录条目和显式文件集合分别不超过 256 个。计数字段最多三位十进制数字，值不超过 255；标题也限制为 255 字节。这些是此实现的范围限制，不是计算器可用 RAM 或完整协议上限的声明。文件名只接受 ASCII 字母、数字、下划线、连字符和句点组成的 basename，拒绝路径、空格、设备名、大小写重复和尾随句点。长文件名可被识别，但不据此承诺每个传输模式均能使用长文件名。

整包检查从 `HP39DIR.CUR` 的唯一目录指针出发，要求每条引用存在、类型一致；
拒绝目录循环、缺失依赖及未引用的多余文件。**目录显示名和 typed 对象标题
是独立字段，默认保留并接受别名。** HP-GCC 为对象 `ARMToolbox39` 写入
`LIB275L` 目录别名；本轮原版 39g+ 的真实传输已经成功请求、接收并安装
这一原样文件组合。调用方可显式指定 `allowTitleAliases:false` 进行更窄的
诊断检查，但文件服务不使用这一旧限制，也不会为了过检查而改写作者包。

命令行只读常规文件，拒绝符号链接和设备，并检查读取期间的文件变化。它不会自动补齐目录、重命名对象或发送任何内容。

## 传输角色与原版系统证据

HP 官方教程要求保留 aplet 配套目录，尤其不能随意更名 `HP39DIR.CUR`
和 `HP39DIR.000`。[5] 原生 39gs 程序作者区分 `USB Disk Drive` 的 Kermit
与 `HP39/40` 的另一路传输入口。[3] hpclang 的原始 USB 安装流程同样由
计算器先取目录，再在用户选中 aplet 后请求 aplet 和配套库。[9]

r17 用未修改的 HP39g+ D1.55 完整镜像，从冷启动原始 APLET 菜单走
RECV → Disk drive，依次完成四个真实请求：

| 文件 | 字节数 | 作用 |
| --- | ---: | --- |
| `HP39DIR.CUR` | 31 | 当前目录指针 |
| `HP39DIR.000` | 67 | aplet 与库的目录 |
| `HPGCC000.000` | 7,373 | `H39 ROM USB` aplet |
| `LIB275L.000` | 1,489 | 对象标题为 `ARMToolbox39` 的库 |

原版 APLET 列表随后显示 `H39 ROM USB`，依赖库由原系统自行请求。检查点
仅由真实执行和按键/USB事务生成，没有注入 guest 对象或改写原厂代码。
这些文件来自用户旧 hpclang 包；浏览器服务器没有采用其程序实现。

同一原版系统的 **SEND → Disk drive… → Send now** 随后返回三份文件：

| 返回文件 | 字节数 | 比较结果 |
| --- | ---: | --- |
| `H39ROMUS.000` | 7,373 | 与输入 `HPGCC000.000` 整份逐字节相同 |
| `LIB275L0.000` | 1,484 | OS 将 typed 标题从 `ARMToolbox39` 改为目录别名 `LIB275L`；其后 1,468 字节对象正文全部相同 |
| `HP39DIR.000` | 66 | 引用原系统选择的两个导出文件名 |

三份返回文件还分别与用户旧包中保留的 `test/` 导出文件逐字节相同。
因此库的五字节长度差来自原系统的标题处理，不能把它误判为 payload 损坏，
也不能为了追求整文件哈希相同而改写返回内容。

USB 适配器在读取设备 IN 后，等下一次普通 guest slice 再发送 HP39 的相关
OUT 回复，让原系统先处理 IN 完成。该修复不增加 core 执行预算，不使用墙钟
延时，也不改变 HP48/49 的后续包调度。未修复的反向 SEND 在第 44 个 DATA
序号附近重复并超时；修复后按生产 Worker 的 1,024 quantum 调用上限完成
上述三文件回收，随后返回 APLET 列表。

无 ROM 测试还覆盖满目录、总字节上限、已收到 15 份文件后同一事务再发两份
的累计上限，以及满目录中的同名替换。服务器在 EOF ACK 前检查尚未提交的
整批文件；只有最终 ACK 实际写入后才发布文件，超限不会被对端误认为保存成功。
此前会话仍留在「已接收文件」列表中的结果同样占用接收容量；controller 把剩余文件数和
字节预算传给协议，不能通过重新开启服务绕过。最终 B 或 FINISH G 的 ACK
丢失时，在固定的两倍协商超时窗口内重发 ACK，不重复发布结果、不延长窗口。

生产浏览器见证使用真实 ROM/多文件选择器，从冷启动开始，经以上原始菜单
上传和回收；三个结果通过真正的浏览器下载保存并比较。两方向使用同一条
USB 连接，最后停止服务、断开 USB，物理按 HOME、`1+1`、ENTER，画面结果
为 `2`。没有页面或 Worker 错误、没有诊断停机，核心预算、普通速度与输入
默认值均保持产品设置。[机器可读证据](evidence/hp39-file-transfer-r17.json)
保存输入/结果、生产资产、私有报告和截图的哈希，不包含 ROM、会话或原始
协议捕获。

r18 ZIP 验证直接选择用户原始发布压缩包，仍完成上述 8,862 字节对象上传和
三文件回收；所有返回文件也与该包的 `test/` 对照导出逐字节相同。点击
**下载完整包**后，以独立的 Python ZIP 读取器核对 CRC、目录入口和全部返回字节。
在无既有 RAM 或保存状态的新浏览器上下文中，同一完整 ROM 冷启动，原版 RECV
再次从这个下载包安装 aplet 与库，共 8,857 字节，APLET 列表恢复显示
`H39 ROM USB`。此流程没有启动 aplet 或执行 ROM stream 命令；传输后 HOME
的 `1+1` 仍显示 `2`。本轮 [ZIP 往返证据](evidence/hp39-archive-r18.json)
单独记录对应生产资产和截图哈希，不替换旧轮次的验证版本。

可复现工具只接受用户自备的原始完整镜像和旧包四文件目录：

```sh
CHROMIUM=/path/to/chrome python3 tools/verify-hp39-file-browser.py \
  --rom /private/39g+.bin --package /private/calculator \
  --expected-wasm <SHA-256-of-dist-orchard.wasm> \
  --output /private/new-hp39-browser-result
```

添加 `--archive /private/hp39gplus-romstream.zip` 后，工具通过文件选择器直接导入
整个发布包，再下载计算器返回文件的 ZIP。随后打开无既有 RAM 或本地保存的全新
浏览器上下文，以同一原始 ROM 冷启动，经 RECV 再次安装这个下载包。`--package`
仍需提供原始四文件目录，供独立字节比较使用。

工具通过普通页面控件操作，旁观 Worker 状态；不会注入 ACK、对象或键盘
消息。它拒绝覆盖输出目录，并在结束时再次核对生产资产和输入文件未变化。
这是一项功能验证，执行时长不能当作模拟性能或实机传输速度基准。

## r19：正常速度的等待、进度与 Wire 路径

本轮先在此前发布的 `5fb9626e…` WASM 和 r18 前端上复现用户的操作，
使用完整原 ROM 冷启动、真实 ZIP 文件选择器和默认 **Normal (1×)**。
从 Disk drive 目录选中 aplet 到 8,862 字节对象全部确认，实测等待
**108.147 秒**。这次没有停机：guest ticks 随墙钟前进，最终安装成功。
但旧界面直到文件累计超过 4 KiB 才更新；首个 aplet 的第一次进度
出现前有 **40.069 秒**没有新进度，小于 4 KiB 的库更没有中间更新。
连接弹窗关闭后也没有持续显示状态。这些因素共同造成“像冻结”的体验。

现在传输状态会显示在计算器上方，连接弹窗内外都能看到当前文件、精确字节、
已耗时和等待提示；变化中的进度最多每 250 ms 通知一次，最终状态立即通知。
接收文件还不知道总长时显示已收到的字节。墙钟只用于这些显示和消息限频，
协议超时仍按 guest ticks 计算；没有提高默认速度或添加额外核心执行预算。

### Disk drive 的等待放大

同一目录检查点、同一 1,024 quantum 普通 slice 的诊断，记录到七次
重传前各约 7.9 秒的 peer NAK 等待，合计约 55.5 个 guest 秒。
这说明等待并非全部来自 CPU 执行太慢；第一处包或确认丢失的固件/USB
内部原因仍未完全定位，不能把缩短重试说成根治全部丢包。

HP39 文件服务器的发送侧现在启用有界自适应超时：从一 guest 秒开始，
用未重传包的往返时间和波动估计后续超时；重传后指数退避，上限为协商值，
重传包或隐式确认不会污染往返时间样本。HP48/49 默认策略和 HP39 接收侧
不变。Kermit 官方文档也区分动态超时与包间暂停。[12]

诊断中保留了所有候选，未挑选或删除失败样本：

| 同一目录检查点实验 | 对象确认所需 guest 秒 | 重传次数 | 处理 |
| --- | ---: | ---: | --- |
| 原策略 | 95.258 | 7 | 保留基线 |
| 每个完整包回复前暂停 50 ms | 265.925 | 28 | 拒绝，未进入产品 |
| USB OUT 片段之间间隔 1 ms | 110.175 | 9 | 拒绝，未进入产品 |
| 一秒起始超时与退避 | 50.008 | 9 | 支持采用有界发送超时策略 |

这些是固定 guest 状态的诊断结果，**不是墙钟速度比较**。最后一行的实验
采用固定一秒基值，产品进一步加入干净 ACK 的往返时间估计，并以协商超时为上限；
不能把该实验的 50.008 秒标为最终产品的 Normal 实测。

**最终生产验收**另以 `eb79a3bc…` WASM 和最终前端，从完整原 ROM 冷启动，
仍经真实文件选择器选择原 ZIP，走原来的 Disk drive 菜单。在其他代理暂停
重任务的窗口内，选中 aplet 到两个对象共 8,862 字节全部确认的墙钟时间为
**49.887 秒**；此前发布版本的对应样本是 108.147 秒。
首个 aplet 进度在发送开始后 **0.388 秒**出现，aplet 和小库分别有 96、17 次
中间进度通知。截图确认连接弹窗关闭后仍显示文件、进度条、字节和已耗时；
安装后 APLET 列表出现 `H39 ROM USB`，HOME 的 `1+1` 为 `2`。
所有速度配置均为 1，没有页面/Worker 错误或诊断停机，运行前后资产哈希不变。
这是单次最终产品交互验证，不把它与诊断 guest 秒混用，也不声称稳定的 CPU
提速倍数。完整阶段与资产身份保存在 [r19 传输证据](evidence/hp39-transfer-r19.json)。

### 原生 Wire 上传的完整验证

`web/hp39-wire.js` 是原创、有限重试的发送器。原版 39g+ 的 RECV → Wire
请求字符为 `D`，实际接受 128 / 1,024 字节分块及 HP 的反射式 CRC-16
（多项式 `0x8408`、初值零、发送时高字节在前）。块序号和反码、逐块 ACK、
最后 EOT 的 ACK 均由原版系统生成。NAK 校验和模式和 `C` CRC 模式另有
独立单元测试；此处原 ROM 见证只证明实际请求的 `D` 路径。作者的 HP
XMODEM 文档提供握手含义的交叉参考，其 48GX/49G 结果不代替我们的 39g+ 见证。[13]

在其他三个代理暂停编译和原 ROM 运行的协调隔离窗口内，真实生产页面从同一
完整 ROM 冷启动，默认 Normal，直接选择用户原始 ZIP。先传 1,489 字节库，
再传 7,373 字节 aplet：

| Normal 浏览器窗口 | 实测墙钟秒 | 计时边界 |
| --- | ---: | --- |
| Wire 库上传 | 1.043 | 确认该文件的 RECV 到最终 ACK 被页面观察到 |
| Wire aplet 上传 | 9.634 | 同上 |
| 两对象完整安装上传 | **13.138** | 首次确认库的 RECV 到两对象均确认，包含再次选择 RECV 的 UI 操作 |
| 后续 Disk drive 回传并验证 ZIP | **184.716** | 点击计算器 SEND 到实际下载 ZIP 的字节检查完成 |

这是一次指定环境的交互计时样本，含 UI 操作及观察开销，不是物理计算器速度
或普遍吞吐保证；协调暂停其他代理重任务也不等于独占整个宿主系统。
它与旧 Disk drive 基线使用不同菜单/协议，不能宣称是 CPU 提速倍数。
**Wire 加快的是上传；当前 stock SEND → Disk drive 回传仍明显较慢。**

此次回传确认整份 aplet 与原始输入逐字节相同；库的 1,468 字节对象体相同，
原系统仍按 `LIB275L` 别名导出，得到原来那份 1,484 字节库封装。实际下载
ZIP 包含三份原系统返回文件及补齐的 `HP39DIR.CUR`，CRC 和每个文件字节
由独立 Python ZIP 读取器检查。APLET 列表显示 `H39 ROM USB`，最后 HOME
的 `1+1` 显示 `2`；没有运行 ROM stream aplet，没有对象注入、原厂代码改写、
页面错误或 Worker 错误。

完整 Wire 往返对应中间生产 WASM `25ceecb4…`，原始报告和所有相关资产哈希
单独保存在 [r19 传输证据](evidence/hp39-transfer-r19.json)。后续最终生产构建
不能冒用这份报告的版本身份；上述最终 Disk drive 验证在该证据内另列。
两次运行的 Worker 与七个 USB/传输模块具有相同哈希；WASM 和 UI bundle
的不同身份仍分别保留。旧 r17/r18 证据原样保留。

原版 **SEND → HP39/40 (Wire)** 并非当前发送器的反向操作：诊断中它先发送
`HP39BinI` 协商对象，再反转方向等待 `D`。本轮没有实现这一双向会话，
因此不提供 Wire 下载，也不声称完整替代 Conn3x 的所有操作。
浏览器内部 USB 也不等于桌面系统枚举的真实 USB 设备；上述 r19 见证没有实机 USB、
外部 Conn3x、39gs 或 40gs 完整 ROM 的新增通过声明。r20 的 39gs 独立结果
在本页能力表与 [39gs 启动记录](hp39gs-startup.md) 另列，不回填旧证据。

复现 Normal 计时与完整回收：

```sh
CHROMIUM=/path/to/chrome python3 tools/probe-hp39-transfer-timing.py \
  --rom /private/39g+.bin --archive /private/hp39gplus-romstream.zip \
  --dist dist --expected-wasm <SHA-256-of-dist-orchard.wasm> \
  --protocol wire --roundtrip --output /private/new-hp39-wire-result
```

改用 `--protocol disk` 可重放目录模式；去掉 `--roundtrip` 只验证上传、
原版 APLET 列表与后续按键。工具旁观 Worker，验证所有速度配置始终为 1，
并核对运行前后资产哈希；完整结果与心跳不因等待过久而删减。

## r20：可恢复批次、任意后缀与临时不限速

新的浏览器功能见证仍使用 HP39g+ D1.55 完整原 ROM 和用户原始 ZIP，
从冷启动经过真实计算器按键与生产页面操作完成，未注入协议 ACK 或修改对象内存。
同一个计算器会话完成以下步骤：

1. 将原始 ZIP 改名为 `.data` 选择导入，内容保持不变；先传库。
2. Normal 下进入实际发送阶段后按 **ON**，收到计算器真实 CAN。
3. 打开“传输时不限速”，重试该库；等待 RECV 时保持 Normal，数据阶段使用
   Unlimited，最终 ACK 后恢复 Normal，已成功库只完成一次。
4. 下一个 aplet 在 Unlimited 发送阶段再次被 ON 中断，报错时立即恢复 Normal；
   跳过该文件后重新选择原 aplet，主机名为 `APLET.unlisted-suffix`，正常安装完成。
5. 新建一个等待 RECV 的请求后在页面取消，队列清除且保持 Normal。
6. 原系统 **SEND → Disk drive…** 回收 aplet、库和目录，再回 HOME 计算 `1+1=2`。

回收的 aplet 为 7,373 字节，逐字节等于输入；库导出为 1,484 字节，
其中 1,468 字节对象内容与 1,489 字节输入库一致，stock 标题/别名 `LIB275L`
保留；目录为 66 字节。原系统安装列表中的 `H39 ROM USB` 和最后算式均已目检。
传输中改变用户速度、关闭开关，以及数据阶段取消、暂停、重置和切换机型的恢复，
另由实际 Worker 代码的隔离回归覆盖；不把这些模拟传输用例写成原 ROM 实跑。

见证使用 WASM `1cffba4f…`、Wire `21b7151d…`、页面 bundle `648d8d65…`。
测试 Worker 仅增加停止时发布其已读取状态的诊断分支，没有额外读内存或执行 guest；
成功过程中没有触发停止。随后界面仅补充“按 ON 后等接收画面退出”的中英提示，
不将新文字 bundle 的身份回填到该次原 ROM 报告。原始报告、相关资产和诊断
Worker 的哈希，以及保留的前序失败分类，见 [r20 传输证据](evidence/hp39-transfer-r20.json)。
这次是功能恢复见证；其 elapsed 时间不用于性能提升或最大吞吐的声明。

## r20：39gs 初始化恢复与有界慢速 SEND

39gs 自身的完整原 ROM 2.22 在普通 8192-tick 协议轮询中暴露了另一种初始化
失败：第一个 Init-Info 的 Y 已经被 USB IRQ 从 FIFO 读出，但应用尚未开启接收
通知。只等待计算器重新发送 I，会在相近相位再次失去这个应答。r20 保留该 Y，
从整帧完全写出之后计一秒虚拟时间，按协商超时上限指数退避，最多主动重发四次。
收到下一条 R/S/G 后清掉尚未开始的重传；已部分写出的帧先完整写完，再允许子事务
发送。取消、失败与新服务都清除状态。此修复不使用固定包间睡眠，不额外执行
guest 指令；正常应答被接受时不引入等待。独立真实 39gs 冷启已通过目录、
10,344 字节 V2 aplet 与 1,489 字节库安装，随后可正常运行原生 reader、返回 HOME
并复用 stock USB；具体原始报告身份见 [r20 39gs 证据](evidence/hp39gs-startup-r20.json)。

真实 39gs 的 stock SEND 还暴露了已有预算不一致：外层文件服务允许 15 分钟，
但单个 Kermit 子事务默认只有五分钟；V2 aplet 仍正常取得进度时，在
8,381 / 10,344 字节处被旧子事务预算截断。HP39 子事务现在继承外层服务的
**剩余**时间，整次服务仍最多 15 分钟虚拟时间，不为每个对象重新获得 15 分钟。
HP48/49 的默认五分钟预算不变，包重试次数与协商超时也不变。协议回归分别检查
超过五分钟的完整慢速收发与接近 15 分钟时新开的子事务。随后独立真实 39gs
冷启动已完成 **HP39/40 (USB)** 安装两项对象，再经 stock Disk SEND 完整回收：
10,344 字节 aplet 逐字节相等，1,484 字节库保留原对象内容与 `LIB275L` 别名，
目录为 65 字节；正常 START 后原生 reader 枚举，拔线提示经 ON 确认后回到 HOME
计算 `1+1=2`。完整反向传输仍经历约 405.4 秒虚拟时间，这不是墙钟速度测试。
该结果使用 39gs 自身的完整 NOR，不扩展到 39gs 串口、40gs 或实物计算器；
具体报告与模块身份见 [39gs 启动证据](hp39gs-startup.md)。

## 39gs 完整 ROM 提取包

旧 hpclang ROM streamer 已复用于 [HP39gs 完整 ROM dump 包](hp39gs-rom-dump.md)。
新交付直接读取完整 1 MiB，主机每块读取两次并校验；不再要求用户先跑
单独的返回程序或短地址采样。39g+ 的本地启动/提取验证、39gs 真机实际
结果和后续机型准入分别记录，不能互相替代。

## 验证与来源边界

自动测试只包含本项目原创的短目录与外层文件数据；其中故意包含无效的内部对象，确认检查器不会把正确文件头提升为执行许可。测试覆盖字节计数、前导空格、非 UTF-8 名称、截断、越界、缺失依赖、类型/标题冲突、路径与大小写冲突、目录循环和读取边界。没有把 HP ROM、用户内容或作者程序加入测试夹具。

格式研究还对以下两个独立发布包做了本地只读对照，整包引用检查均通过，内部载荷、硬件与上传状态仍然未验证。第三方文件不随本模块发布，检查通过也不构成对这些程序运行安全性的认可。

| 原始发布包 | 包的 SHA-256 | 本地检查范围 |
| --- | --- | --- |
| HP `linearin.zip`，15,150 字节 | `74358de9cd661d576e16ff94da202fb57c319c019e0e1d56b1e5cd30f01d4dce` | 10 个 typed / directory 文件，共 5,395 字节 |
| 作者 `romupl39.zip`，78,499 字节 | `39c75d020aa5ab39904d70381bfbf2b79c0faf68fd0f78c3c5ca817ed21276b1` | 4 个 typed / directory 文件，共 1,457 字节 |

### 一级资料

1. Arnie97 / HP-GCC Team：[minstub39 `howtopatch.txt`](https://github.com/Arnie97/minstub39/blob/f53ac527e9894f3730c6a66284e23139fdaef931/howtopatch.txt)、[`hpgccaplet.s`](https://github.com/Arnie97/minstub39/blob/f53ac527e9894f3730c6a66284e23139fdaef931/hpgccaplet.s)、[`LICENSE`](https://github.com/Arnie97/minstub39/blob/f53ac527e9894f3730c6a66284e23139fdaef931/LICENSE)。用于文件布局及调用关系证据；本模块没有复制 launcher、SDK 或模板代码。
2. Christoph Gießelink：[ROMUPL39 1.3 作者发布包](https://www.hpcalc.org/details/7801)，本地检查其中 `HP39DIR.CUR`、`HP39DIR.000`、`RomUpl.000` 与 `LIB1537L.000`；不分发其代码或二进制。
3. Arnie97：[Neko Notepad 的 39gs 使用说明](https://github.com/Arnie97/neko-notepad/blob/485f426b08fa202eb42a375c6c6175f50989acf6/readme_39gs.txt)、[`hp39dir.000`](https://github.com/Arnie97/neko-notepad/blob/485f426b08fa202eb42a375c6c6175f50989acf6/hp39dir.000)。用于作者的 `HP39AscC` 文件与传输模式经验，不采用 GPL 程序实现。
4. Arnie97：[grob-maker `grob.py`](https://github.com/Arnie97/grob-maker/blob/9a82839ce263d7fc734e002d43ed8c156a98e87e/grob.py)，用于作者产生的 `HP39AscD` 名称封装，不采用图像或程序生成实现。
5. HP / Colin Croft：[Mastering the hp 39gs & hp 40gs](https://literature.hpcalc.org/official/hp39gs40gs-mastering-en.pdf)，F2224-90010，2006；机型区别、电脑连接、aplet 下载与 HPGCC 章节。另以 HP 官方 [Linear Inequality 原始 aplet](https://www.hpcalc.org/details/4170) 作外部格式对照。
6. Arnie97：[Clock Tuner README](https://github.com/Arnie97/clock-tuner/blob/138efa3eca8f5745e6391e2544a7cc92694dbd48/README.md)。仅采用作者的机型、版本和依赖说明；不建议用户运行调频功能，不采用 GPL 程序实现。
7. Yanye0xFF：[ROMViewer](https://github.com/Yanye0xFF/ROMViewer/tree/85726dad3871e75976c606894256dfc1a9686b1c)，尤其 `src/ROMViewer.c`、`src/crt0.c` 与 Apache-2.0 `LICENSE`。只读源码研究，不执行或重新分发其二进制。
8. James Bergamin：[Saturnus 作者的 HP39 文件服务器模块说明](https://github.com/ractive/saturnus/blob/7244b7ae9aac83adb00dae275ba40c770bc0189a/crates/saturnus-tx/src/aplets.rs)。用于客户端/服务器角色的交叉核对；该项目含 AI 辅助生成代码，不作为本项目的真机验证证据，也没有复制其解析器或传输实现。

9. 用户 hpclang 项目：[HP39g+ 原始 USB 安装序列](https://github.com/maxmixalex/hpclang/blob/53856bc7/tests/e2e/sequences/hp39gplus-stock-usb-run.seq)，固定功能提交。用于核对菜单、客户端角色和按需依赖请求，不复制其协议实现。
10. PKWARE：[APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)，ZIP 本地头、中央目录、CRC-32、stored 与 DEFLATE 方法的格式规范。
11. WHATWG：[Compression Standard](https://compression.spec.whatwg.org/)，浏览器原生 `DecompressionStream('deflate-raw')` 接口。
12. Kermit Project：[C-Kermit 10 Command Reference](https://www.kermitproject.org/ck10commandref.html)，`SET SEND TIMEOUT` 的动态超时与 `SET SEND PAUSE` 的包间暂停；本模块未复制 C-Kermit 实现。用户 hpclang 的 [stock USB 传输说明](https://github.com/maxmixalex/hpclang/blob/261dba7cc5b208828f7a907c2071d24c3b0d94ea/docs/development/stock-usb-transport.md) 提供候选设置，本轮按上表独立保留否定结果。
13. xmodem-proto 作者：[0.9.0 协议说明](https://docs.rs/xmodem-proto/0.9.0/xmodem_proto/index.html)，HP 握手 `D`、标准 `C` 与 NAK 的区别；其自述仿真 49G/48GX 结果只作交叉参考，不构成 HP39 验证，也未复制其状态机实现。
