# 39gs 原生入口：ROM、ARMToolbox 与下一步探针

## 当前能让用户配合的最小检查

先取得 **39gs 的完整版本屏幕与现有库列表**。此步骤不安装 ARM 程序，也不采集 flash 映像。

1. 在原版 HOME 输入普通命令 `VERSION`，按 ENTER，拍下完整结果，包括版本前缀和日期。HP 的原始入口表包含该命令；经销商自己的操作页及截图也展示了 HOME 输入和版本结果。[1][2] 不把 `2.22` 下载包名或其他机型的版本当作这台机器的版本。
2. 打开 **SHIFT → MEMORY**，记下 Memory Manager 右上角的可用内存，再选择 **Libraries**，按屏幕下的 **SHOW**，拍下 Library Manager 列表。HP 用户指南 14-9 和 Mastering 手册第 30–32 页展示了这一路径；这里仅查看，不按 DEL / CLEAR。[3][4] 重点看是否已有 `ARMToolbox39` / `ARMToolbox 39 1.0` / Library 275，并保留原来的完整名称。

若机器已经装有 ARMToolbox，记录其来源或当时保存的库文件即可；不覆盖已有库。若没有，现阶段也不需要用户安装。**低于作者所述 2.22 门槛时先记录并停止该原生探针路线，不为本任务升级固件。** 不需要重复提供已有 39g+ 或 48gII 映像。

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

本轮已找到可对应的 39 专用源码、构建脚本和现存库文件，但 **尚未重建并逐字节证明源码与该 1,489 字节文件一致**。已核对的源码 Git blob 与 SHA-256 记在 [研究身份清单](evidence/hp39-native-prerequisites-r13.json)，不会用“同一仓库”替代这项缺失验证。

## 安装、移除及调用边界

作者的原始说明要求 aplet 与库一起传输。使用 conn3x 的 `HP 39/40` 传输方式时，依赖不会自动装上，需要单独传入 aplet 和 `lib275.sys`；作者建议在 Memory Manager 中确认 L275，缺少它会出现 `Undefined XLIB Name`。[5] 本项目还没有在真机上验证这组文件的安装、自动关联和移除生命周期，因此这里不把旧作者包作为现在应运行的采集包。

HP 手册说明，部分原生 aplet 关联的库会随 aplet 删除；Memory Manager 也提供分类管理。[3][4] 共享 L275 的多个程序、手工发送的库及旧目录别名可能影响具体行为。未来试用前应记录现有库，退出原生 aplet，再只删除本次探针；随后检查 L275 是否还在以及其他原有程序是否受影响。没有验证依赖关系之前，不要求用户手工删除或替换已有 L275。

`minstub39` 的 `_Entry` 从 aplet 取出数据和当前 view，调用 `PrRUN` 的库 275、命令 0；正常返回后保存数据并丢弃 view 参数。`_Exit` 保存 aplet 数据并离开 graph view。[9] 所以“原生程序已经返回”与“已经退出 aplet、恢复普通计算和传输”是两项不同检查，固定文本探针必须覆盖两者。

### 目录名称不能混为一谈

HP39 目录记录中的主机 **basename** 指向具体传输文件；目录的 **显示名** 与 typed 文件内的 **对象标题** 是独立字段。[10] 本轮定位到真实生产者的明确反例：

| 位置 | 主机文件名 | 目录显示名 | typed 对象标题 |
| --- | --- | --- | --- |
| SDK `hp2aplet.c::createSupportFiles` | `LIB275L.000` | `LIB275L` | `ARMToolbox39` |
| Clock Tuner v1.2 发布包 | `lib275.sys` | `LIB275L` | `ARMToolbox39` |

SDK 把 `LIB275L.L39` 原样复制为 `LIB275L.000`，并独立生成上述目录记录；其 `makefile.bat` 则独立写入 typed 标题。因此不能宣称三者必须相同，也不能因这一个差异判定作者文件已损坏。[8][10]

目前本项目的整包检查有一个更窄的宿主策略：目录显示名与对象标题必须相同。它会将上述别名映射报告为 **`HP39_UNSUPPORTED_TITLE_ALIAS`**；拒绝行为不变，单文件封装检查仍可通过。尚未验证真实 HP39 接收、显示、重命名、再发送时如何处理别名，所以本轮不放宽这一子集、不改写作者包、不开放上传。

## 固定文本探针的最小设计

下一份可审查的探针应先证明 **ARM 进入、正常返回、aplet 退出后普通计算/传输仍可用**，不访问任何候选 flash 地址。下面是设计与验收步骤，尚不是可下载或可直接运行的计算器程序。

1. **先锁定启动链。** 使用经过重建比对的 39 专用 L275、明确 ROM 版本的 SysRPL entry 表和可复核的 aplet wrapper。以解析到的对象边界核对 library 275 / command 0、ARM 主入口和长度，不嵌入猜测的固件函数地址。
2. **ARM 载荷只做返回。** 候选实现为原创、无库依赖的 ARM leaf；不读取 flash，不访问 LCD/时钟/USB寄存器，不使用 heap，不请求 MMU 重排。需要先证实 PrRUN/ARMSYS 所提供的返回 ABI、对象 flags 和 padding，才确定最终机器码。没有完成这项证明前，不生成供用户运行的 `.apt`。
3. **文本在成功返回后显示。** SysRPL wrapper 只有在 `PrRUN` 正常返回后，才通过既有 OS 显示机制显示固定的 `ORCHARD ARM RETURN OK`。文字不由 ARM 直接操作 LCD 产生，以减少需要假定的硬件状态。此设计只测试入口/返回，不据此声称 ARM 已经成功读写采集缓冲区。
4. **验证栈与生命周期。** 对包装对象做独立解析；确认 view 与 aplet 私有数据的栈进出平衡，明确退出按键。重新构建两次须一致，并审查实际 ARM 反汇编。39g+ D1.55 的运行结果只能补充研究，不能替代 39gs 目标 ROM 验证。
5. **小范围真机验收。** 在先决齐全后，才交付带源码、hash、版本清单的原创探针。用户启动看到固定文本，退出到普通 Function / HOME，计算 `1+1`，再把一份无敏感内容的短笔记正常传出；重复一次。记录过程中有无重启、丢失设置或遗留活动 aplet，不把 reset 后恢复当作正常返回成功。
6. **后续另开读取阶段。** 只有这一轮通过，才设计固定 16 字节读取及无损回传；物理 flash 映射、boot 区覆盖、双读与完整采集继续单独验证。现在不提供 39gs 全 flash reader。

## 许可证与交付状态

SDK 根 README 声明 HP-GCC 项目及库采用 GPL v2 或更新版本，并列出额外例外文字；Clock Tuner 发布包带 GPL v2 LICENSE；`minstub39` 仓库使用 MIT。[5][7][9] 这些来源各自适用，不能由 `minstub39` 的 MIT 推导整个 SDK 或 L275 二进制也是 MIT。此处只记录来源和证据，没有将 SDK、库、启动器、HP 头文件或第三方二进制复制进模拟器，也没有发布第三方工具包。

目前仍缺的具体交付门槛是：用户现有 ROM/库身份；39 专用库的源码重建对应；只返回 ARM leaf 的 ABI 与封装证明；同一目标机器的退出、传输及删除行为。已找到的静态材料足以明确下一步工作，但不足以把一个完整读取程序交给用户执行。

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
