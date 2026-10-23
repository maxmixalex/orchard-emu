# HP39/40 文件服务与格式

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
| HP39gs / HP40gs USB 或串口，Disk drive… | 同一有限内存服务器 | 协议与适配器回归；各机型仍需完整 ROM 启动见证 |
| HP39g+ 串口 | 不开放文件能力 | 此机型没有 39gs/40gs 的有线串口；保留原始数据诊断 |
| HP39/40 (Wire) | 独立的旧传输路径 | 当前文件服务使用 Disk drive，不把两者混同 |

每次选择最多 16 个对象及其两个目录文件、总共 8 MiB、每文件最多 2 MiB。自动目录计入总字节
上限。主机 basename 限制为 64 个 ASCII 字节，拒绝
路径、大小写重复、保留设备名和尾随句点。服务最多运行 15 分钟虚拟时间，
活动 Kermit 事务仍有重试与超时限制；这些均不是实机速度承诺。

ZIP 导入按 PKWARE ZIP 格式和浏览器 Compression Streams 标准接受 stored 和 DEFLATE 文件，[10][11]
压缩包上限 32 MiB、目录记录上限
1024 项，解压后的对象仍遵守上述限制。优先读取发布包的 `calculator/` 目录，
其次读取根目录或唯一 HP39 目录；只解压目录明确引用的文件。README、接收器
EXE、源码和 `test/` 对照导出不会成为计算器对象。路径遍历和重复项会阻止导入；
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
不代替 39gs/40gs 的完整原生启动验证。

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

本轮用未修改的 HP39g+ D1.55 完整镜像，从冷启动原始 APLET 菜单走
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

后续 ZIP 验证直接选择用户原始发布压缩包，仍完成上述 8,862 字节对象上传和
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
