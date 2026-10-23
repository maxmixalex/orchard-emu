# 39gs 原生入口：ROM 与 ARMToolbox 来源

## 当前完整读取路线

直接使用 [HP39gs 完整 ROMstream 包](hp39gs-rom-dump.md)。它重用已经在用户
39g+ 上成功的 reader，包含可直接传输的 aplet、39 专用库、Windows 接收器和
对应源代码；不再要求先运行返回或短读探针。本页保留版本、库与目录格式的
来源研究。安装前仍应查看现有版本和 Library 275，避免替换已有不匹配的库。

1. 在原版 HOME 输入普通命令 `VERSION`，按 ENTER，拍下完整结果，包括版本前缀和日期。HP 的原始入口表包含该命令；经销商自己的操作页及截图也展示了 HOME 输入和版本结果。[1][2] 不把 `2.22` 下载包名或其他机型的版本当作这台机器的版本。
2. 打开 **SHIFT → MEMORY**，记下 Memory Manager 右上角的可用内存，再选择 **Libraries**，按屏幕下的 **SHOW**，拍下 Library Manager 列表。HP 用户指南 14-9 和 Mastering 手册第 30–32 页展示了这一路径；这里仅查看，不按 DEL / CLEAR。[3][4] 重点看是否已有 `ARMToolbox39` / `ARMToolbox 39 1.0` / Library 275，并保留原来的完整名称。

若机器已经装有 ARMToolbox，记录其来源或当时保存的库文件即可；不覆盖已有库。若没有，可在核对版本后按探针专页分别传入库和 aplet。**低于作者所述 2.22 门槛时先记录并停止该原生探针路线，不为本任务升级固件。** 不需要重复提供已有 39g+ 或 48gII 映像。

`VERSION` 的显示示例来自经销商自身的操作记录，而不是 HP 用户手册中一个已找到的命令章节；HP 的普通用户指南未列出这一命令。原始 entry list、显示截图与用户这台机器的返回信息承担不同的证据作用。本页没有用诊断组合键代替版本查看。

## ROM 2.22 是哪一种先决条件

Clock Tuner 作者报告在原版 39gs 上测试，并在“启动重启或挂起”的说明中要求 ROM 2.22 或更新，同时要求重新传输 aplet。[5] 这给出了该作者程序的兼容性下限，不能扩大为“所有 ARM 程序在所有 2.22 机器都已验证”。

HP 的原始升级包说明，C222 修改了支持的 entry list，并修复一组发生偏移的 entry points；这与依赖 SysRPL entry 的启动器有关。[6] 本轮只读核对了包内 PDF，第 4 页变更记录，没有运行或分发更新文件。包内固件是 **995,328 字节更新映像**，不是本项目所需的完整物理 NOR。升级步骤及其重置要求不属于本探针方案。

## 已经定位的 39 专用库

以下两个独立发布位置提供字节完全相同的 **1,489 字节**文件：

| 发布位置 | 文件 | 证据 |
| --- | --- | --- |
| Arnie97 的 Clock Tuner v1.2 发布包 | `lib275.sys` | 作者发布包确实包含此库，README 要求 L275。[5] |
| HP-GCC 1.1 补丁 SDK，固定 commit `7fa1503912338ea0fdf1d39eb584770f4d121cd2` | `LIB275L.L39` 与 `sources/HP39-Aplet/Binaries/LIB275L.L39` | 两个路径的 Git blob 相同；本轮与前一发布包逐字节比对。[7] |

共同 SHA-256：

```text
88b0d556ae86784dc0e3ede7f53a45ece12d2513128b4fc96b9655bf881dcdd1
```

现有原创检查器给出的外层信息为：`HP39BinH`、二进制库对象、12 字节标题 `ARMToolbox39`、载荷从字节 21 开始、载荷长 1,468 字节。该结果只认证文件身份与 typed 封装，仍是 `payloadValidated: false`、`hardwareValidated: false`，不构成执行许可。

39 专用源码在 SDK 的 **`sources/HP39-Aplet/LIB275/`**，而不是通用 `sources/ARMToolbox/masd_source/`。[8]

| 源文件 | 明确可核对的事实 |
| --- | --- |
| `lib275.s` | ROMID 为十六进制 `113`，即十进制 275；第一 ROMP 是 `PrRUN`，后面是 `ShSPLASH` 与 `HpgccABOUT`；配置例程调用 `TOSRRP`。 |
| `makefile.bat` | 生成 `HP39BinH` 外层、标题 `ARMToolbox39`；构建名称为 `ARMToolbox 39 1.0`；依赖 `sasm`、`rplcomp`、`makerom`、`sload` 及 `SUPROM39`。 |
| `SEXE.s` | `PrRUN` 实现会整理内存、检查/对齐 ARM 对象、设置入口，再用 ARMSYS 进入 ARM；含普通 RAM 路线及由 flags 选择的 MMU 路线，只支持主入口。 |

同一 SDK 中还存在 48/49 家族的 `L275_48.LIB`（2,404 字节）与 `LIB275.LIB`（4,474 字节），其同号库不能替换 39 专用文件。通用 ARM ToolBox 2.0 README 中的 `FixSto`、端口 1/2、`FnRUN` 等说明不能直接套用到 `ARMToolbox 39 1.0`。[7][8]

现已用 HPTools 3.0.8 与作者的 64 位构建补丁，从这些固定源码重新生成
**1,489 字节、SHA-256 完全相同**的库。包内构建工具逐一锁定输入源码 hash，
并要求重建库符合上述原分发物身份。早期查证记录保留在
[研究身份清单](evidence/hp39-native-prerequisites-r13.json)；新结果与可重复构建命令见
[返回探针专页](hp39-return-probe.md)。源码与二进制对应的缺口已闭合，真机运行仍待验证。

## 安装、移除及调用边界

作者的原始说明要求 aplet 与库一起传输。使用 conn3x 的 `HP 39/40` 传输方式时，依赖不会自动装上，需要单独传入 aplet 和 `lib275.sys`；作者建议在 Memory Manager 中确认 L275，缺少它会出现 `Undefined XLIB Name`。[5] v1 包使用这一传输流程，提供自己的最小返回 aplet 和源码重建的同版库。其安装、自动关联和移除生命周期仍未在本机验证；旧作者程序不作为采集程序执行。

HP 手册说明，部分原生 aplet 关联的库会随 aplet 删除；Memory Manager 也提供分类管理。[3][4] 共享 L275 的多个程序、手工发送的库及旧目录别名可能影响具体行为。未来试用前应记录现有库，退出原生 aplet，再只删除本次探针；随后检查 L275 是否还在以及其他原有程序是否受影响。没有验证依赖关系之前，不要求用户手工删除或替换已有 L275。

`minstub39` 的 `_Entry` 从 aplet 取出数据和当前 view，调用 `PrRUN` 的库 275、命令 0；正常返回后保存数据并丢弃 view 参数。`_Exit` 保存 aplet 数据并离开 graph view。[9] 所以“原生程序已经返回”与“已经退出 aplet、恢复普通计算和传输”是两项不同检查，固定文本探针必须覆盖两者。

### 目录名称不能混为一谈

HP39 目录记录中的主机 **basename** 指向具体传输文件；目录的 **显示名** 与 typed 文件内的 **对象标题** 是独立字段。[10] 本轮定位到真实生产者的明确反例：

| 位置 | 主机文件名 | 目录显示名 | typed 对象标题 |
| --- | --- | --- | --- |
| SDK `hp2aplet.c::createSupportFiles` | `LIB275L.000` | `LIB275L` | `ARMToolbox39` |
| Clock Tuner v1.2 发布包 | `lib275.sys` | `LIB275L` | `ARMToolbox39` |

SDK 把 `LIB275L.L39` 原样复制为 `LIB275L.000`，并独立生成上述目录记录；其 `makefile.bat` 则独立写入 typed 标题。因此不能宣称三者必须相同，也不能因这一个差异判定作者文件已损坏。[8][10]

目录别名已作为明确字段支持，整包校验不会要求显示名与 typed 标题相同。
原版 HP39g+ 已经通过真实 Disk drive 请求安装此包；反向 SEND 时，系统会将
库标题导出为目录别名，但保持库对象体相同。详情和逐字节边界见
[HP39 文件格式](hp39-files.md) 与 [文件传输](file-transfer.md)。

## 历史最小返回探针（当前不要求先执行）

[v1 ZIP](../downloads/hp39gs-arm-return-v1.zip) 包含可传输的 `ORCHRET.000`、
匹配的 `lib275.sys`、中文安装步骤、完整对应源文件和重建工具。它只验证
**ARM 进入、正常返回、aplet 退出后普通计算/传输仍可用**这条路径，不访问候选 flash 地址。

1. **启动链身份。** 39 专用 L275 的固定源码已重建为原发布物。解析最终 aplet
   的 40 个目录字段、四个代码入口和唯一 `XLIB 275,0` 调用；按实际对象边界
   检查 ARM 字符串，不嵌入猜测的固件函数地址。
2. **ARM 载荷。** 只有 `bx lr` 一条 ARMv4T 指令，使用 HP-GCC 原始 ABI 文档
   记录的 LR 返回约定。V3 字符串提供完整对齐区、没有可选尾结构；匹配库的
   此分支请求零额外 RAM，不进入 MMU 重排路线。代码不使用 heap，不操作数据内存或外设。
3. **返回显示。** 新 SysRPL wrapper 在调用前清除标记，仅在 `PrRUN` 正常返回后
   设置标记并显示 `ARM RETURN OK`。ARM 本身不操作 LCD。HOME 退出后仍须检查
   Function、`1+1` 和正常传输；这些不是结构检查能证明的性质。
4. **验证边界。** 包已离线重建、固定产物 hash 并独立检查对象结构；在 HP39gs
   真机或原厂系统中安装和运行尚未验证。具体运行、返回、重复进入和移除步骤见
   [专页](hp39-return-probe.md)。39g+ 的任何观察也不能替代 39gs 目标 ROM 验证。
5. **当前采集入口。** 原有的“返回后再做短地址采样”分阶段计划已经由
   [完整 ROMstream 包](hp39gs-rom-dump.md)取代。现可一次启动读取整个 1 MiB，
   每个 16 KiB 块复读并逐字节比较，直接交回完整 `.bin` 和 `.json`；本页的
   返回探针仅保留历史说明，不是完整读取包的前置步骤。

## 许可证与交付状态

SDK 根 README 声明 HP-GCC 项目及库采用 GPL v2 或更新版本，并列出额外例外文字；Clock Tuner 发布包带 GPL v2 LICENSE；`minstub39` 仓库使用 MIT。[5][7][9] 这些来源各自适用，不能由 `minstub39` 的 MIT 推导整个 SDK 或 L275 二进制也是 MIT。

v1 将编译后的计算器 aplet 与库按 GPLv2+ 分发，附带完整对应源、构建脚本、
GPL 正文和原始版权说明；新写的源码保留兼容 GPL 的 MIT 许可。第三方源码仅在
独立探针 ZIP 中，不并入模拟器核心，也不分发外部 HPTools 编译器。仍缺的实际结果是
用户现有 ROM/库身份、同一目标机器的启动、正常退出、传输及删除行为，以及后续
真实地址读取和全量回传。这份交付不构成完整 flash 读取或 HP39gs 启动支持。

## 一级资料与原始文件

1. HP 原始 `SUPROM39.A` 入口表随 SDK 保存，其中有 `xVERSION` / `xxVERSION`：[固定源码](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/HP39-Aplet/LIB275/SUPROM39.A)。只作为命令存在的佐证，不据此复制或调用裸地址。
2. Educalc 自身的 [39gs 操作说明与实机显示截图](https://www.educalc.net/page/1644485/)。这是经销商的原始操作材料，不冒称为 HP 官方手册。
3. HP：[HP 39gs User's Guide，Edition 3，14-9](https://h10032.www1.hp.com/ctg/Manual/c00751802.pdf)。本轮已查看原页的 SHIFT / SHOW 键图。
4. HP / Colin Croft：[Mastering the hp 39gs & hp 40gs，第 30–32 页](https://literature.hpcalc.org/official/hp39gs40gs-mastering-en.pdf)。库管理页面亦已查看原页。
5. Arnie97：[Clock Tuner README](https://github.com/Arnie97/clock-tuner/blob/138efa3eca8f5745e6391e2544a7cc92694dbd48/README.md)、[v1.2 作者发布页](https://github.com/Arnie97/clock-tuner/releases/tag/v1.2)。只核对其依赖与作者经验，不要求用户运行调频程序。
6. HP 原始升级说明，归档在 [39gs ROM 2.22 发布条目](https://www.hpcalc.org/details/7098) 的 ZIP 中；包 SHA-256 `d5c2530bbda3adbbfc7906337392b1cef66a0ee3455e0cb967846eb82683b485`，PDF SHA-256 `ea233f7d3c01f3b179ab9b8e022ff482a22960285978c92233460a30614d12d9`。不重发 PDF 或 ROM。
7. HP-GCC Team 的 1.1 发行物，经补丁维护者保存：[README.TXT](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/README.TXT)、[39 库文件](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/LIB275L.L39)。
8. HP-GCC Team：[39 专用源码与构建脚本目录](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/tree/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/HP39-Aplet/LIB275)。不以通用 ARMToolbox 2.0 README 代替此实现。
9. Arnie97 / HP-GCC Team：[minstub39 启动与返回代码](https://github.com/Arnie97/minstub39/blob/f53ac527e9894f3730c6a66284e23139fdaef931/hpgccaplet.s)、[MIT LICENSE](https://github.com/Arnie97/minstub39/blob/f53ac527e9894f3730c6a66284e23139fdaef931/LICENSE)。
10. HP-GCC Team：[hp2aplet.c 原始发包代码](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/HP39-Aplet/hp2aplet/hp2aplet.c)，重点是 `createSupportFiles` 与 `createAplet`；只作为格式事实来源，未复制实现。
