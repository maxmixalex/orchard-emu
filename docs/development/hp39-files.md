# HP39 文件检查与 39gs 只读探针准备

## 本轮已实现的部分

`web/hp39-files.js` 是原创、无依赖的 HP39 文件外层格式检查器，可在浏览器和 Node 中使用。它能解析 `HP39AscA` 目录、检查 ASCII/二进制对象的名称封装，并核对一个明确指定的文件集合是否包含完整、无循环的目录引用。它不读取计算器，不执行内部对象，也不改变任何机型的运行许可。

```sh
# 查看单个文件的类型、标题长度、载荷位置和 SHA-256
node tools/hp39-file-info.mjs /private/APLET.000

# 只检查明确指定的这几个文件，不递归扫描目录
node tools/hp39-file-info.mjs --bundle \
  /private/HP39DIR.CUR /private/HP39DIR.000 /private/APLET.000

# 无 ROM 测试
node tests/hp39-files.mjs
```

这是后续 HP39 Kermit 文件服务器的准备工作。**检查通过只说明封装和引用关系符合当前支持的范围，不说明 aplet / SysRPL / ARM 载荷可以安全执行，也不说明 39gs 已经能在模拟器中启动。** 普通对象始终返回 `payloadValidated: false`；整包返回 `hardwareValidated: false`、`uploadEnabled: false`。目录本身可完成字段检查，但这不传递为对其引用程序的认可。

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

整包检查从 `HP39DIR.CUR` 的唯一目录指针出发，要求每条引用存在、类型一致；拒绝目录循环、缺失依赖及未被引用的多余文件。**当前宿主严格子集还要求目录显示名与 typed 对象标题逐字节一致；这不是已证明的通用 HP39 格式约束。** HP-GCC 1.1 的发包源码会为名为 `ARMToolbox39` 的库写入 `LIB275L` 目录别名。此类映射返回 `HP39_UNSUPPORTED_TITLE_ALIAS`，明确表示当前整包子集未支持；不宣称原包损坏。单独的目录与 typed 文件仍可各自检查。具体来源与现存发行物的对照见 [39gs 原生探针先决核对](hp39-native-prerequisites.md)。

命令行只读常规文件，拒绝符号链接和设备，并检查读取期间的文件变化。它不会自动补齐目录、重命名对象或发送任何内容。

## HP39 的传输角色需要单独实现

HP 官方教程说明，下载 aplet 时需保留配套目录文件，尤其不能随意更名 `HP39DIR.CUR` 和 `HP39DIR.000`。[5] 原生 39gs 程序的作者还区分了两种入口：`USB Disk Drive` 使用 Kermit，`HP39/40` 使用 XMODEM；在其原生程序活动期间不能建立 USB 连接，需要先退出 aplet。[3]

因此，现有 HP48gII 的 Kermit 客户端上传流程不能作为 HP39 已完成传输的证据。HP39 的 disk-drive 路径需要由电脑侧服务目录请求、计算器侧发起读取；另一个实现作者也明确采用这种角色划分。[8] 此模块只准备文件封装与依赖检查；启动、USB 枚举、Kermit server、目录请求、实际载荷往返和计算器内解释仍须各自验证。

## 39gs 的只读 flash 探针：已找到入口，尚未交付真机程序

用户现有的原始完整映像是 39g+ 与 48gII；39gs/40gs 的完整原生 NOR 仍缺。39g+ 的 D1.55 HOME 运行证据不能替代 39gs 的原生入口或固件版本验证。39gs 与 40gs 也不能互换 ROM；HP 手册明确说明两者的系统功能与内部硬件存在差异。[5]

目前不需要用户重复提供已有映像，也不要求用户刷写其他固件。49g+ 的阶段式读取包见 [flash 采集指南](flash-capture.md)。39gs 先完成以下具体门槛，再给用户一个可复核的小程序。

| 门槛 | 已得到的一级证据 | 尚需完成的验证 |
| --- | --- | --- |
| 原始 OS 能运行 ARM aplet | Clock Tuner 作者明确报告在原始 39gs 真机使用，构建链为 HP-GCC 1.1、`minstub39` 和 ARM ToolBox。[6] | 确定目标计算器的现有 ROM 版本；作者的兼容说明要求 2.22 或更新。不能据此要求用户升级 ROM。 |
| 从 aplet 调用 ARM 并返回 | `minstub39/hpgccaplet.s` 的 `_Entry` 调用 L275 的 `PrRUN`，随后恢复 aplet 的数据与 view 参数；代码同时展示退出路径。[1] | 核对实际 L275 发行物、源码、许可证和 hash，审核原生入口及返回时的栈、寄存器、IRQ/MMU 状态。不能把其他机型的 L275 库当作同一个包。 |
| 可读取一个可观察的地址范围 | ROMViewer 作者为 39gs 发布源码：初始 ARM 地址为零，读取后显示；启动代码保存和恢复 LCD 状态与中断。[7] | 其原程序可跳到任意地址，不适合作为我们的固定长度探针。需改为固定范围的 16 字节读取，先验证显示/返回路径，再验证地址与字节顺序。 |
| 确认读到的是完整物理 NOR | 上述材料证明的是作者使用的 ARM 地址访问方式。 | stock OS 下的虚拟地址到物理 flash 映射、boot 区与顶端范围尚未独立证明；显示一个向量前缀并不能证明全区间。不得把逻辑映像当成完整物理 dump。 |
| 将结果无损带回主机 | 已有 typed 文件与目录格式证据；本轮增加了检查工具。 | 原生程序退出后，再通过普通传输取回固定命名、明确长度的结果；必须先取得 16 字节实际往返证据。 |

ROMViewer 本身不会因为项目名称含 ROM 就自动成为本项目认可的采集工具。它允许任意地址浏览，且公开 README 没有给出固件版本矩阵或完整 flash 覆盖证明。其地址访问和启动源码可以作为研究依据，本项目没有把它的二进制分发给用户，也没有复制其实现进模拟器。[7]

### 下一步应产生的具体证据

1. 固定 39gs 原生启动包的来源、版本、许可证和校验值，并把依赖放在单独工具包中。现有 `minstub39` 仓库使用 MIT；HP-GCC / ARM ToolBox 的发行物还需分别核实，不能把一个仓库的许可证套到另一个二进制上。[1][6]
2. 在能够复核的环境中先执行仅显示固定文本、返回 OS 的 aplet，记录返回后的普通计算和传输仍可使用。此阶段不访问候选 flash 地址。
3. 为同一入口编译固定的 16 字节只读 payload，禁止用户输入地址，禁止 flash 指令、擦除、固件更新、时钟修改及不必要的 MMU 修改。保存/恢复显示或 IRQ 所需操作应在源码和二进制审查中逐项对照。
4. 确认 stock OS 映射后，才请求用户运行小探针。比对屏幕或回传文件的长度、字节顺序与两次读取一致性；实际机器验证前在清单中保留 `hardware_validated: false` 与 `physical_mapping_verified: false`。
5. 只有小探针完整通过，才设计分段、双读、校验与断点恢复的完整采集程序。ROMUPL39 的 Saturn 可见映像输出不能替代这一步对 ARM 原生 boot 区的覆盖检查。[2]

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
