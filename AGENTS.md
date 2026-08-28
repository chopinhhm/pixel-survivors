# AGENTS.md — 给 AI Agent 的项目速读与启动指南

> 你（agent）读完本文件即可拉取、启动、验证并继续开发本项目，无需任何额外上下文。

## 这是什么

**像素幸存者（pixel-survivors）**：浏览器端 roguelite 游戏，元气骑士 × 以撒的结合体。
纯前端，零后端，零运行时依赖——构建产物是一个 ~136KB 的 JS，浏览器打开即玩。

- 仓库：`https://github.com/chopinhhm/pixel-survivors`（主分支 `main`，无其他长期分支）
- 技术栈：**TypeScript（strict）+ Vite 5 + 原生 Canvas 2D + 原生 WebAudio**
- 没有游戏引擎、没有 UI 框架、没有音频文件（音乐音效全部代码合成）
- 美术：0x72 DungeonTileset II（CC0，已入库 `public/sprites/`，共 58 张；**源仓库已 404，勿尝试重新下载**）+ 程序化生成的地砖/图标

## 快速启动

```bash
git clone https://github.com/chopinhhm/pixel-survivors.git
cd pixel-survivors
npm install          # 若 devDependencies 未装上（有的环境全局配了 omit=dev），用 npm install --include=dev
npm run dev          # Vite 开发服务器，默认 http://localhost:5173
```

验证与构建：

```bash
npm run check        # tsc --noEmit 类型检查（改完代码必跑）
npm run build        # 产物在 dist/，纯静态，任意 HTTP 服务器可托管
```

环境要求：Node 18+（开发时用的 24），npm。Windows/macOS/Linux 均可。

## 玩法与操作（验证游戏是否正常时用）

标题页 → Enter 进家园 → 走到传送门按 E 出发。

| 键 | 作用 |
|---|---|
| WASD / 方向键 | 移动 |
| 鼠标左键按住 | 主武器开火（朝准星） |
| 鼠标右键 | 副武器（独立冷却） |
| Space / Shift | 冲刺（无敌帧） |
| Tab / X | 切换双武器槽 |
| E | 交互（传送门/拾取武器/开箱/购买） |
| Q | 主动技能（清房充能） |
| P | 暂停（含完整 build 面板） |
| I / C / V / T | 家园快捷键：背包 / 角色 / 军械库 / 试炼 |

核心循环：家园 → 6 层地牢（每层清房 → Boss → 下层）→ 通关或阵亡 → 战利品带回家 → 装备/解锁变强 → 再出发。通关后可选无尽模式；试炼层级（0~15）逐级加难。

## 代码地图（src/，共 ~7000 行）

| 文件 | 行数级 | 职责 |
|------|--------|------|
| `game.ts` | ~2900 | **模拟核心**：状态机、房间流转、战斗、道具结算、存档快照。改玩法主要在这 |
| `render.ts` | ~1700 | **全部渲染**：只读 Game 状态绘制，不改任何模拟状态。通过 `import type { Game }` 避免运行时循环依赖 |
| `consts.ts` | ~280 | 常量与类型：房间尺寸、敌人表、Boss 表、楼层主题、精英词缀、难度曲线常量 |
| `runitems.ts` | ~550 | 局内道具（46 件）+ 协同（18 条）+ 主动技能（10）+ 诅咒（7）+ 数值预览 |
| `arsenal.ts` | ~150 | 可拾取武器（14 把，元气骑士式）+ 掉落规则 |
| `weapons.ts` | ~55 | 副武器（右键，6 把） |
| `ascension.ts` | ~90 | 试炼层级（15 级难度修正） |
| `rooms.ts` | ~160 | 楼层生成（枝状房间图、特殊房分配） |
| `layouts.ts` | ~190 | 房间地形模板 + Boss 专属战场 |
| `chars.ts` | ~65 | 角色（4 个，差异靠开局道具表达） |
| `items.ts` | ~125 | 局外装备（词缀生成、部位、稀有度） |
| `achievements.ts` | ~110 | 成就（9 个，绑定角色解锁） |
| `save.ts` | ~175 | localStorage 持久化：局外档案 + 局内房间粒度快照（RUN_VER 版本门控） |
| `sprites.ts` / `assets.ts` | | 程序化像素画 + CC0 素材加载 |
| `audio.ts` | ~130 | WebAudio 合成音效 + 三层背景音乐（探索/Boss/狂暴） |
| `main.ts` / `input.ts` / `util.ts` | | 启动循环 / 键鼠输入 / 工具函数 |

## 必须知道的架构约定（违反会引入 bug）

1. **id 命名空间**：道具/主动/诅咒/角色/协同/副武器六个空间的 id 不得互撞；可拾取武器统一 `w` 前缀。历史上撞过两次（`freeze`、`laser`），修复代价大。
2. **存档只存 id 不存对象**：道具带 `apply()` 函数，JSON 序列化会丢函数。读档一律查表还原。改动 `RunSave` 结构必须递增 `save.ts` 里的 `RUN_VER`（当前 v7），旧档自动作废——比读出半残的局安全。
3. **房间缓存的 key 只有 `gx,gy`，跨层会重复**：`roomObs` / `roomPeds` / `roomGuns` 三个 Map 在 `nextFloor()` 与 `reset()` 里必须 `clear()`，漏一个就会跨层串数据（历史上真出过）。
4. **render.ts 不修改模拟状态**；`consts.ts` 的存在就是为了打破 game↔render 的值依赖环，新常量放 consts 而不是 game。
5. **状态机完整性**：`State` 每个取值必须同时有 `game.ts` 的 `case 'xx':` 与 `render.ts` 的 draw 分发（或走主渲染路径）。历史上 `armory` 漏接过 draw，界面完全不显示但编译通过。
6. **难度原则**：难度靠致命性（伤害/移速）不靠血条厚度。改数值前先跑模拟（见下）。
7. **敌人防御机制不叠加**：有角度减伤/石化这类机制的敌人血量必须压低（盾卫曾因 70 血 + 正面减伤 70% 等效 233 血拖垮清层节奏）。

## 数值验证方法（本项目的测试方式）

没有单测框架。验证方式是把纯逻辑模块单独编译到 Node 跑模拟脚本：

```bash
npx tsc src/runitems.ts src/consts.ts src/chars.ts --outDir /tmp/t --module commonjs --target es2020 --skipLibCheck
node /tmp/t/xxx.js   # 自己写断言脚本 require 这些模块
```

历史上靠这个方法抓到的问题：协同触发率被扩池稀释 45%、防御侧零成长、盾卫双重防御、id 冲突、死配方（协同依赖不存在的道具 id）。改平衡/加内容后建议至少验证：

- 新 id 与六命名空间无冲突
- 每件新东西有实际效果（apply 后与 baseline 不同）
- 极限叠加无 NaN/负数/归零
- 楼层生成不变式：Boss/宝箱恒 1 个、特殊房不重复、起点不被覆盖、全连通

## 已知未完成 / 可继续的方向

- **全程无实机试玩验证**：所有手感（顿帧、弹反、武器手感）只有代码与数值层面验证，从未有人真正玩过。起服务实测并修手感问题是最高价值的下一步。
- 局内存档未保存地上武器（读档后消失，已注释说明，属可接受损失）。
- 结算页数据可视化、家园成就陈列墙——讨论过未做。
- 音效没有单独的近战/弹反音、拾取武器音。
- 无移动端适配（触屏没有输入路径）。

## 线上部署

游戏已部署在腾讯云轻量服务器（与「技能集市」共用一台，nginx 同站不同路径）：

- **游玩地址**：`http://124.221.92.107/game/`
- 服务器接入：`ssh -i ~/.ssh/skill-market-deploy ubuntu@124.221.92.107`（密钥在开发机上）
- 静态文件位置：`/var/www/pixel-survivors/`；nginx 配置在 `/etc/nginx/sites-available/skill-market` 的 `/game/` location（改动前先备份，`nginx -t` 通过再 reload）

更新线上版本：

```bash
npx vite build --base=./          # 必须用相对 base，子路径部署下绝对路径会 404
tar -czf /tmp/pxsurv-dist.tar.gz -C dist .
scp -i ~/.ssh/skill-market-deploy /tmp/pxsurv-dist.tar.gz ubuntu@124.221.92.107:/tmp/
ssh -i ~/.ssh/skill-market-deploy ubuntu@124.221.92.107   'sudo tar -xzf /tmp/pxsurv-dist.tar.gz -C /var/www/pixel-survivors && rm /tmp/pxsurv-dist.tar.gz'
```

注意：素材加载走 `import.meta.env.BASE_URL`（见 `assets.ts`），新增静态资源时不要写死以 `/` 开头的绝对路径。
同机跑着技能集市生产服务（sm-app/sm-mysql/sm-redis），部署动作只允许触碰 `/var/www/pixel-survivors` 与 nginx 的 `/game/` 段。

## 提交规范

- 直接提交到 `main` 并推送（单人项目，无分支流程）。
- 提交信息用中文，`feat(game): ...` / `balance(game): ...` / `refactor: ...` 风格，正文写清楚**为什么**与验证结果，参考 `git log`。
- 提交末尾加 `Co-Authored-By` 署名行（沿用历史提交格式）。
