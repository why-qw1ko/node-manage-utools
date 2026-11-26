# Node 版本管理 — utools 插件

一个 utools 插件，用于管理多版本 Node.js、切换镜像源、管理全局包、查看环境变量和进程。

## 功能概览

### Node 版本管理（依赖 nvm-windows）
- 显示当前 Node.js 版本及已安装版本列表
- 切换已安装版本，设置默认版本
- 安装 / 卸载指定版本
- **版本搜索与过滤**：按版本号搜索已安装版本，支持全部/当前使用过滤；可安装版本标注 LTS
- **安装进度反馈**：实时显示安装日志，安装过程中可主动取消
- **未完成的版本**：可从本地版本卡片重新安装，或确认清理下载残留
- **安装源配置**：一键切换 Node/npm 安装源（官方/淘宝/华为云）
- **项目版本自动检测**：打开项目目录时自动检测 `.nvmrc`/`.node-version` 并提示切换

### 镜像源切换
- 内置源：npm 官方、淘宝 npmmirror、华为云、腾讯云
- 支持添加 / 删除自定义镜像源
- 一键切换、复制 registry URL
- 自定义镜像源通过 utools.db 持久化保存

### 全局包管理
- 查看所有全局安装的 npm 包
- 搜索过滤包名
- 安装新包 / 卸载 / 更新单个包
- 显示操作状态和完成结果

### 配置文件快速打开
- `.npmrc`（用户级 & 全局）
- `.nvmrc` / `.node-version`
- `hosts`
- npm 全局目录 / 缓存目录
- nvm 安装目录
- **npm 配置可视化**：展示完整 `npm config list`，支持复制

### 环境变量管理
- 查看 `NVM_HOME`、`NVM_SYMLINK` 和 `WINDIR`
- 查看 npm 配置项（`prefix`、`cache`、`registry` 等）
- 一键复制变量值

### Node 进程管理
- 查看当前运行的 Node.js 进程
- 显示 PID、内存占用、启动命令
- 终止指定进程
- **按端口关闭**：输入端口号，自动检测占用进程及其目录、命令行等详细信息。系统关键进程只显示检测结果，其他系统服务需要二次确认后才能终止

### 文件夹解除占用
- 根据进程可执行文件路径或命令行中的目录路径查找可能占用指定文件夹的进程；无法识别仅以该目录为工作目录或仅持有文件句柄的进程
- 支持手动输入路径、系统对话框选择、读取当前资源管理器路径，使用带盘符的本地文件夹路径
- 系统关键进程只显示检测结果，其他系统服务需要二次确认后才能终止

### 磁盘占用分析
- 分析各 Node.js 版本的磁盘占用
- 查看 npm 缓存大小、全局包总大小
- 一键清理 npm 缓存

## utools 关键词入口

| 关键词 | 功能 |
|--------|------|
| `node` `nvm` `npm` | 进入主界面 |
| `镜像` `镜像源` `registry` `npm镜像` | 进入镜像源管理 |
| `全局包` `npm包` `global` `包管理` | 进入全局包管理 |
| `.npmrc` `npmrc` | 直接打开 .npmrc |
| `.nvmrc` `nvmrc` | 直接打开 .nvmrc |
| `.node-version` | 直接打开 .node-version |
| `hosts` `hosts文件` | 直接打开 hosts 文件 |
| `npm配置` `npm config` | 打开 npm 全局配置目录 |
| `nvm目录` `nvm dir` | 打开 nvm 安装目录 |
| `环境变量` `env` `node环境` | 进入环境变量管理 |
| `node进程` `进程管理` `tasklist` | 进入进程管理 |
| `解除占用` `文件夹占用` `文件占用` `unlock` | 进入文件夹解除占用 |
| `磁盘` `占用` `清理` `disk` | 进入磁盘占用分析 |

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 框架 | Vue 3 | Composition API + `<script setup>` |
| 构建 | Vite 6 | `base: './'` 相对路径，适配 utools 本地加载 |
| 图标 | unplugin-icons + @iconify-json | 构建时编译为 inline SVG，零外部请求 |
| Node 桥接 | preload/services.js | 通过 `window.nodeAPI` 暴露 exec、fs、path、os |
| 持久化 | utools.db | 仅保存自定义镜像源 |

## 项目结构

```
Node多版本管理/
├── public/
│   ├── plugin.json              # utools 插件配置（入口、关键词、preload）
│   ├── preload/
│   │   ├── services.js          # Node.js 能力桥接（child_process / fs / path / os）
│   │   ├── filesystem.js       # 项目版本声明读取与磁盘占用统计
│   │   ├── process-service.js   # 进程与端口操作的固定 PowerShell 脚本
│   │   ├── nvm-settings.js      # NVM 配置定点更新与 root 保护
│   │   └── package.json         # type: commonjs（preload 需 CJS 格式）
│   └── logo.png                 # 插件图标
├── src/
│   ├── main.js                  # Vue 入口
│   ├── main.css                 # 全局样式、CSS 变量（浅色/深色主题）
│   ├── App.vue                  # 主布局，utools.onPluginEnter 事件调度
│   ├── views/
│   │   ├── NodeManager.vue      # Node 版本管理页
│   │   ├── MirrorManager.vue    # 镜像源管理页
│   │   ├── PackageManager.vue   # 全局包管理页
│   │   ├── ConfigFiles.vue      # 配置文件管理页
│   │   ├── EnvManager.vue       # 环境变量管理页
│   │   ├── ProcessManager.vue   # 进程管理页
│   │   ├── FolderUnlock.vue     # 文件夹解除占用页
│   │   └── DiskUsage.vue        # 磁盘占用分析页
│   ├── components/
│   │   ├── Sidebar.vue          # 侧边导航栏
│   │   ├── VersionCard.vue      # 版本卡片（切换/卸载）
│   │   ├── MirrorCard.vue       # 镜像源卡片（切换/复制/删除）
│   │   ├── PackageCard.vue      # 全局包卡片（更新/卸载）
│   │   ├── EnvCard.vue          # 环境变量卡片（复制值）
│   │   ├── ProcessCard.vue      # 进程卡片（终止进程）
│   │   ├── PortKillDialog.vue   # 按端口关闭进程弹窗
│   │   └── ConfigFileCard.vue   # 配置文件卡片（打开/复制路径）
│   ├── utils/
│   │   ├── command.js           # 命令执行封装（exec / execWithProgress）
│   │   ├── nvm.js               # nvm-windows 操作（list/install/use/uninstall）
│   │   ├── nvm-mirror.js        # nvm 安装源配置（node_mirror / npm_mirror）
│   │   ├── npm.js               # npm 操作（registry/config/list）
│   │   ├── process.js           # 进程/端口/文件夹占用检测与终止
│   │   ├── store.js             # utools.db 持久化封装
│   │   └── utools.js            # utools API 封装（通知/剪贴板/打开路径/Toast）
│   └── constants/
│       ├── mirrors.js           # 内置镜像源列表
│       └── files.js             # 配置文件路径定义（npmrc/nvmrc/hosts 等）
├── vite.config.js               # Vite 构建配置
├── jsconfig.json
├── package.json
└── .gitignore
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式（localhost:5173）
npm run dev

# 生产构建（输出到 dist/）
npm run build

# 预览构建产物
npm run preview
```

### utools 开发模式

1. 运行 `npm run dev` 启动开发服务器
2. 在 utools 开发者工具中加载项目目录（会读取 `public/plugin.json`）
3. `plugin.json` 中 `development.main` 指向 `http://localhost:5173`，utools 会自动连接

## 构建产物

```
dist/
├── index.html              # 入口页面
├── plugin.json             # 插件配置（从 public/ 复制）
├── logo.png                # 图标（从 public/ 复制）
├── preload/
│   ├── services.js         # Node.js API 桥接（从 public/ 复制）
│   ├── filesystem.js      # 受限的文件读取和磁盘扫描
│   ├── process-service.js  # 进程管理脚本
│   ├── nvm-settings.js     # NVM 配置保护
│   └── package.json        # type: commonjs
└── assets/
    ├── index-*.css         # 样式
    └── index-*.js          # 应用逻辑（Vue + 组件 + 工具）
```

## 注意事项

### preload 桥接
所有 Node.js API（child_process、fs、path、os）通过 `preload/services.js` 注入到 `window.nodeAPI`，渲染进程不直接使用 `require`。preload 目录下 `package.json` 声明 `"type": "commonjs"` 以确保 CJS 模块正常加载。

### nvm-windows
- 插件通过 `NVM_HOME`、`PATH` 和 Windows 默认安装目录检测 nvm-windows。
- 未安装时可从「Node 版本」打开官方发布页，下载并运行 `nvm-setup.exe`。安装后回到插件点击「重新检测」。自定义安装路径在 Windows 更新环境变量后需要重新启动 uTools 才能生效。
- npm 镜像源和全局包管理也支持独立安装的 Node.js。

### 数据持久化
- 自定义镜像源通过 `utools.db` 存储，键前缀 `node-manager:`
- 当前 registry 每次从 npm 配置读取，不在插件数据库中重复缓存
- Node 已安装版本、NVM 路径和环境变量均不写入 `utools.db`

### NVM 配置保护
- 读取安装源时只读取 `settings.txt`，不会调用 NVM 配置命令
- 切换安装源时仅更新 `node_mirror` 或 `npm_mirror`
- 写入前创建 `.mirror-backup` 备份，并校验 `root` 未发生变化
- 如需恢复上一次写入前的配置，可先核对 NVM 安装目录中的 `settings.txt.mirror-backup`，再用它恢复 `settings.txt`。

### 操作确认与失败恢复

- 全局包安装和更新须经系统对话框确认，弹窗会显示包名、目标目录和 Registry。npm 会跳过常规生命周期脚本，部分 Git 依赖的准备步骤仍可能执行代码。切换到 HTTP 镜像需要确认。
- 终止进程会复查 PID、创建时间和进程名。端口检测只检查 TCP 监听，文件夹检测根据路径和命令行推断。权限不足或检测超时时应重新检测。
- 清理 npm 缓存前显示生效目录，确认后若发现目录变化则停止清理。扫描不完整时，页面会给出已读取空间的下限。
- 版本操作超时或结果无法验证时，先刷新查看实际状态，再决定是否重试。

### 图标
使用 `unplugin-icons` 在构建时将 `@iconify-json/mdi` 和 `@iconify-json/logos` 中的图标编译为 inline SVG 组件，运行时无外部网络请求。

### Toast 提示
插件内置了类型化的 Toast 提示系统：
- **成功**（绿色）：操作成功完成
- **错误**（红色）：操作失败
- **警告**（黄色）：输入校验等警告
- **默认**（深色）：普通信息提示

## License

MIT
