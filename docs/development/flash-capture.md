# HP49g+ 原机 Flash 读取包

> **2026-10-23 更新：已收到用户的完整 49g+ A/B 捕获。** 2 MiB 映像的
> SHA-256 为 `3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab`。
> 本轮已用原始字节完成冷启动、CAS、绘图和 USB 文件传输验证，见
> [49g+ 支持记录](https://maxmixalex.github.io/orchard-emu/development/hp49-startup/)。无需重跑下面的短探针；下文保留原采集包
> 的完整使用说明，供重新采集时参考。采集元数据与后续执行证据分别保存。

这是 Orchard 的原始、开源读取程序包，目标是取得 **HP49g+ 的完整 2 MiB
物理 NOR 内容，包括开头 16 KiB ARM boot 区**。它使用 HP 官方文档中的
`PEEKARM`，不包含 ARM 机器码、刷机程序或固件。结果写到 SD 卡上的新目录；
计算器内部 Flash 不作为写入目标。

**当前状态：二进制对象结构和主机组装器有独立测试；HP49g+ 真机及其 SD
文件封装尚未实测。首次请只做下面两个 16 字节探针，并把探针结果和系统版本
发回。核对探针及该系统的地址映射后再做 A/B 全量读取。** 文件存在、长度正确或两次相等本身，
都不能证明固件已经在模拟器冷启动成功。

`PEEKARM` 读取的是运行中系统的 **ARM 地址空间**。硬件 NOR 基址为零是当前
模型的起点，但本次尚未证明原厂各版本在运行时都把 `0x000000–0x1fffff` 连续
映射到完整物理 NOR。这个包不修改 MMU；输出首先是候选映像。起始 vector、
boot 哈希和 A/B 一致性可提供交叉证据，不能单独证明整段物理映射；报告明确
保留 `physical_mapping_verified: false`。

下载现成包：[hp49gplus-flash-read-v1.zip](../downloads/hp49gplus-flash-read-v1.zip)。
包内含可执行 `.hp`、对应 `.rpl` 源码、中文说明、离线组装器、MIT 许可和
`SHA256SUMS`。不需要在计算器上安装编译器，不包含 HP 固件或第三方二进制。

## 适用条件

- **只用于 HP49g+，原厂系统 ROM 2.00 或更新版本**。在计算器执行 `VERSION`
  记下版本。较早版本、HP49G、39gs/40gs 不使用本包；遇到命令缺失时回报即可，
  不需要为读取操作升级或替换系统。
- 一张这台计算器已经能正常读写的 SD 卡及读卡器，至少 10 MiB 可用空间。
  使用现有可用卡，无需格式化。完整两轮保存为十六进制字符串，约占 8.01 MiB，
  主机还需要存放 2 MiB 拼装结果。
- 建议有约 100 KiB 空闲用户 RAM。程序一次处理 16 KiB 原始数据，产生 32 KiB
  字符串；不会一次把整个 Flash 放进用户 RAM。这个空间建议尚待真机核实。
- 组装器需要 Node.js 22 或更新版本，无 npm 依赖、不联网。没有 Node.js 也可以
  私下提供原始捕获文件，由我们组装核对。

HP 的 [Advanced User's Reference](https://literature.hpcalc.org/official/hp50g-aur-en.pdf)
印刷页 6-6（PDF 第 504 页）规定 `PEEKARM` 输入分别是 ARM 地址和**字节数**；
命令表 I-18（PDF 第 660 页）列出 `XLIB 256,36`，自 ROM 2.00 起提供。
这与读取 Saturn 地址空间的 `PEEK` 不同。

## 1. 准备 SD 卡并执行内存探针

1. 将 ZIP 解压到电脑。保留解压包原件，便于核对程序哈希。
2. SD 卡根目录必须没有名为 `ORCHARD` 的旧目录。若已有，把旧目录改名保存；
   不要删除或合并旧捕获。然后复制包内的**空** `ORCHARD` 目录到卡根目录。
3. 将 `OR49P.hp`、`OR49T.hp`、`OR49A.hp`、`OR49B.hp` 复制到卡根目录。
   `.rpl` 是供审阅的 UTF-8 源码，不是需要上传的二进制程序。
4. 将卡放回计算器。以下命令按 RPN 模式输入；可用 MODE 选择 RPN，完成后再恢复
   原模式。先保留好自己需要的栈内容，然后输入：

   ```text
   :3:"OR49P.hp" RCL EVAL
   ```

这个程序只执行：

```text
« #00000000h #00000010h PEEKARM »
```

它从地址 `0x00000000` 读取 16 字节，留下一个 **32 个十六进制字符**的字符串，
不写 SD。请记录字符串及 `VERSION` 输出。若出现错误或字符数不对，停在这里，
将错误文字发回，不继续全量读取。

预期采用 HP 十六进制串的低半字节优先顺序：例如原始字节 `0xEA` 对应两个字符
`AE`，不是把整个字符串倒过来。这个约定与 HP 的 `S→H` / `H→S` 示例一致，
但仍需本次 `PEEKARM` 探针确认。手工阅读的 ARM 指令字还需按小端组合四个字节。

## 2. 验证 SD 文件格式

确认卡上的 `ORCHARD` 目录仍为空，再输入：

```text
:3:"OR49T.hp" RCL EVAL
```

它读取相同的 16 字节，把字符串保存为 `ORCHARD/OR49T000`。它没有完成提示，
正常执行后回到栈。这个探针只应运行一次；再次试验请先在电脑上改名保留旧
`ORCHARD`，再创建全新空目录。**`STO` 没有由本包验证的独占新建保证，旧同名
捕获可能被覆盖；新空目录是运行前提。**

将卡放回读卡器。在电脑解压包目录运行（将路径改成你的实际路径）：

```sh
node tools/flash-capture.mjs probe /path/to/SD/ORCHARD/OR49T000
```

Windows 例子：

```powershell
node tools/flash-capture.mjs probe E:\ORCHARD\OR49T000
```

预期文件是 45 字节：8 字节 `HPHP49-*` 传输头、5 字节字符串对象头、32 字节
ASCII 十六进制串。工具严格核对封装和长度，按低半字节优先解码，并检查起始
ARM reset 指令。输出 `bytes: 16`、`nibble_order: "low-first"` 和哈希只是
短探针检查，不是完整 Flash 认证。请提供这个小文件或 JSON 输出及第一步结果。
若文件长度或封装不符，保留原件，我们据此修正工具，不要自行删头、补零或交换
字节以强行通过。

HP [User's Guide](https://literature.hpcalc.org/official/hp50g-ug-en.pdf)
印刷页 26-11 至 26-12（PDF 第 779–780 页）说明用 `:3:"目录/文件"` 寻址 SD
文件。官方 AUR 的命令表 I-25（PDF 第 667 页）列出 `STO = XLIB 2,341`。
程序里固定使用 port 3，未使用写入内部 Flash 的 port 2。

## 3. 核对探针和地址映射后，做两轮完整地址范围读取

保持 Flash 内容不变，不在两轮之间安装库、移动内容到内部 Flash 或更新系统。
正常的 RAM 栈变化不需要清除。保存好探针文件；随后依次运行：

```text
:3:"OR49A.hp" RCL EVAL
```

等栈中出现 `OR49 A complete: 128 chunks`，再运行：

```text
:3:"OR49B.hp" RCL EVAL
```

等 `OR49 B complete: 128 chunks` 出现后，将卡放回电脑。不要在写卡时移除卡。
首次真机耗时尚未测量；无论哪一步报错，保留已写文件和错误文字，不把中途结果
当作完整读取。如果要重做 A 或 B，先保留整个旧目录，再从空目录开始两轮。

| 内容 | ARM 地址范围 | 数量 / 长度 |
| --- | --- | --- |
| A 轮 `OR49A000` 至 `OR49A127` | `0x000000–0x1fffff` | 128 文件，每个 32,781 字节 |
| B 轮 `OR49B000` 至 `OR49B127` | 同上，重新执行读取 | 128 文件，每个 32,781 字节 |
| 每个文件对应的原始数据 | 起址为编号 × `0x4000` | 16,384 字节 |
| 第一块中的 ARM boot 区 | `0x000000–0x003fff` | 16 KiB |
| 最终候选映像 | 按 ARM 地址连续拼装，物理映射待核实 | **2,097,152 字节** |

每一轮实际调用 `PEEKARM` 128 次，B 轮不是复制 A 轮文件。程序不会填补缺段、
拼接升级包，也不会拿其他机型的 boot 区替换读到的内容。

## 4. 组装并核对

先把 `ORCHARD` 整个目录复制到电脑的私人目录，保留卡上原始文件。运行：

```sh
node tools/flash-capture.mjs assemble /private/ORCHARD /private/hp49gplus-full.bin
```

输出路径必须是新文件。成功后得到原始映像及 `hp49gplus-full.bin.json` 报告。
工具拒绝缺块、重复名字、非普通文件、符号链接、错误头、错误长度、非十六进制
内容及 A/B 任一字节不一致。它还核对 ARM vector，拒绝已知其他机型的原始
boot 区，以及 boot 以外完全为空白的结果。未知 boot 版本会保留原字节并明确
保持未认证状态。

JSON 包含候选映像、开头 16 KiB、各块及原始捕获文件的 SHA-256。请私下提交
**原始 A/B 捕获、完整映像、JSON、计算器型号和 VERSION 输出**；不要公开上传
固件。完整 NOR 也可能含个人保存到 Flash 的对象。

`independent_reads_equal: true` 证明两轮一致；`physical_mapping_verified: false`、`boot_verified: false` 和
`catalog_admitted: false` 刻意保留。开发者仍须确认地址映射、数据来源和原系统
冷启动，才能增加用户可选的 ROM preset。哈希一致不会自动解锁机型。

## HP39gs / HP40gs 及其他模型

目前没有可交付的、已核实在 **39gs 原厂系统**中读取全部原生 ARM NOR 的程序。
因此先不请你在 39gs 上执行猜测性的机器码，也不请你重刷系统。需要的 39gs
范围是完整 1 MiB；40gs 是 2 MiB。已有官方升级包不能补成原始全量映像。

作者的 [ROM Upload for HP38/39/40 (ROMUPL39)](https://www.hpcalc.org/details/7801)
附源码针对 Saturn bank 窗口及 Emu48；审阅到的读取循环不覆盖原生 ARM boot
区，所以它不替代本任务的完整物理 NOR 提取。2019 年 39gs `bootldr.txt` 线索
涉及替代系统环境，且只有 16 KiB；不作为本次原厂系统操作步骤。

49g+/50g 已有的原始 boot 区仍只各占 16 KiB。HP50g 与 HP49g+ boot 哈希不同；
本包不以共同 OS 更新文件推导它们可以互换。本次交付首先推进用户手上的 49g+，
39gs 的原厂只读传输程序仍是下一项明确的开发缺口。

## 源码与可重复构建

生成器是 Orchard 原始 MIT 代码。二进制格式依据 Gilbert Fernandes / Eric
Rechlin 的 [Introduction to Saturn Assembly Language](https://literature.hpcalc.org/community/intro-saturn-asm.pdf)
第 57 章；只使用 program、user binary、string、tagged object 和 ROM pointer
对象，没有复制书中的程序或其他项目实现。命令号来自上面的 HP 官方命令表。

在完整 Orchard 仓库中重建相同 ZIP：

```sh
python3 tools/package-flash-capture.py /new/hp49gplus-flash-read-v1.zip
node tests/flash-capture.mjs
```

ZIP 固定条目顺序、时间戳与权限；输出路径已存在则拒绝覆盖。包内所有可执行
程序与辅助源码都列在 `SHA256SUMS` 中。现成 ZIP 由源码构建，不包含本机路径、
固件片段或捕获数据。
