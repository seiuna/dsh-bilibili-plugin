---
tags:
  - DeepSeekHarness
  - DSH
  - 插件开发
  - 架构解析
  - 开发教程
---

# DeepSeek Harness (DSH) 插件开发全景实战指南

> 本文系统梳理了 DeepSeek Harness (DSH) 的底层微内核架构、生命周期、扩展点以及端到端开发插件的标准范式。通过本文，你可以从零开始开发并调试自己的 DSH 工具型插件、后端服务插件或前端 WebUI 插件。

---

## 目录
- [一、DSH 核心架构解密](#一dsh-核心架构解密)
  - [1.1 基于 Cordis 的微内核系统](#11-基于-cordis-的微内核系统)
  - [1.2 双端协作模型（Node 宿主端 + Web 浏览器端）](#12-双端协作模型node-宿主端--web-浏览器端)
  - [1.3 Profile 配置与多环境管理](#13-profile-配置与多环境管理)
- [二、插件的三大核心形态](#二插件的三大核心形态)
  - [形态 A：Agent 工具型插件（Tool Plugin）](#形态-aagent-工具型插件tool-plugin)
  - [形态 B：后端服务与 API 插件（Backend API Plugin）](#形态-b后端服务与-api-插件backend-api-plugin)
  - [形态 C：Web 客户端界面插件（Client UI Slot Plugin）](#形态-cweb-客户端界面插件client-ui-slot-plugin)
- [三、核心 API 与关键约定](#三核心-api-与关键约定)
  - [3.1 Cordis 插件生命周期规约](#31-cordis-插件生命周期规约)
  - [3.2 动态配置模式（Schemastery）](#32-动态配置模式schemastery)
  - [3.3 工具注册规范（defineTool）](#33-工具注册规范definetool)
  - [3.4 前端插槽体系（Slots System）](#34-前端插槽体系slots-system)
  - [3.5 打包契约与 cordis.patch.yml](#35-打包契约与-cordispatchyml)
- [四、实战演练：从零开发一个完整插件](#四实战演练从零开发一个完整插件)
  - [4.1 项目结构设计](#41-项目结构设计)
  - [4.2 编写 package.json 与构建配置](#42-编写-packagejson-与构建配置)
  - [4.3 编写 Cordis 装配清单 cordis.patch.yml](#43-编写-cordis-装配清单-cordispatchyml)
  - [4.4 编写后端入口与自定义工具（Node.js 端）](#44-编写后端入口与自定义工具nodejs-端)
  - [4.5 编写 WebUI 客户端扩展（React / TypeScript 端）](#45-编写-webui-客户端扩展react--typescript-端)
- [五、插件调试、部署与常见踩坑指南](#五插件调试部署与常见踩坑指南)
  - [5.1 本地联调与注册方法](#51-本地联调与注册方法)
  - [5.2 避坑要点：安全沙箱与文件观察策略](#52-避坑要点安全沙箱与文件观察策略)
  - [5.3 避坑要点：热更新 (HMR) 机制](#53-避坑要点热更新-hmr-机制)

---

## 一、DSH 核心架构解密

### 1.1 基于 Cordis 的微内核系统
DeepSeek Harness (DSH) 本质上是一个以 **Cordis**（一种在现代化 Node.js 全栈框架中广泛使用的依赖注入与插件微内核）为基石的高性能 Agent 运行时框架。

在 DSH 中：
1. **万物皆插件**：无论命令行、WebUI、文件系统、模型调度、沙箱拦截还是具体的 Agent 工具，都是挂载在 Cordis 树上的一个插件（Plugin）。
2. **IoC（控制反转）与服务依赖注入**：插件声明自己需要的服务（例如 `export const inject = ['tools', 'webServer']`），Cordis 容器会自动根据依赖拓扑关系决定插件的初始化时序。
3. **隔离与生命周期管理**：每个插件都运行在独立的上下文作用域（Context）中。当插件卸载或更新时，框架会自动回收注册的定时器、事件监听器、HTTP 路由和 Agent 工具。

### 1.2 双端协作模型（Node 宿主端 + Web 浏览器端）
DSH 采用前后端同构与分层解耦架构：
```text
┌────────────────────────────────────────────────────────┐
│                   DSH Node 宿主端                      │
│  Cordis 运行时  │  Agent 引擎  │  dsh-tools (工具总线)  │
│  Web 服务器     │  沙箱隔离    │  ClientModuleRegistry │
└───────────────────────────┬────────────────────────────┘
                            │ /plugins/??... 打包资源分发
                            │ WebSocket / REST 状态通讯
┌───────────────────────────▼────────────────────────────┐
│                  DSH Web GUI 浏览器端                  │
│  ClientModuleSystem  │  Slots 注册表  │  React 渲染树   │
│  国际化 (i18n)       │  会话状态机    │  UI 视图组件    │
└────────────────────────────────────────────────────────┘
```
- **Node 宿主端**：管理系统级资源，提供 `ctx.tools`、`ctx.webServer`、`ctx.fs`、`ctx.sandbox` 等核心服务。
- **Web 浏览器端**：由 `@deepseek-ai/dsh-client-modules` 统一管理。通过在 HTML `<head>` 中注入 `window.__DSH_BOOT__` 启动图，按需惰性加载客户端 bundle，并通过前端的 **Slots（插槽）** 系统把组件动态嵌入到 DSH 界面中。

### 1.3 Profile 配置与多环境管理
DSH 采用多 Profile 设计。用户所有运行时插件与依赖存放在：
- 配置文件：`~/.dsh/settings.yaml`
- Profile 目录：`~/.dsh/profiles/<profile_name>/`
  - 例如 `web` profile 的配置位于：`~/.dsh/profiles/web/package.json`
- 插件的安装通常通过在指定 profile 的 `package.json` 中添加依赖或直接通过 `pnpm dsh plugin --profile <name> add <package>` 完成。

---

## 二、插件的三大核心形态

在 DSH 生态中，根据功能需求，插件通常分为以下三种典型形态（或它们的组合）：

### 形态 A：Agent 工具型插件（Tool Plugin）
- **代表案例**：`dsh-obsidian`、内置文件操作工具。
- **核心目的**：向 LLM 暴露新的能力工具（如读写知识库、查询天气、调用外部 API、操作数据库）。
- **技术要点**：
  - 依赖 `@deepseek-ai/dsh-tools`；
  - 使用 `defineTool()` 定义输入参数的 JSON Schema、输出格式与执行体 `execute()`；
  - 注册后，参数定义与描述会自动流入 System Prompt 和 LLM 的 Function Calling 参数中。

### 形态 B：后端服务与 API 插件（Backend API Plugin）
- **代表案例**：`dsh-git-gui-plugin` 的后端路由部分。
- **核心目的**：向宿主内置的 Web 服务注册自定义 HTTP API（GET/POST）或 WebSocket，为前端提供底层操作系统支持（如 Git 操作、Shell 执行、文件树分析）。
- **技术要点**：
  - 声明注入 `webServer` 服务（`export const inject = ['webServer']`）；
  - 使用 `ctx.webServer.register({ kind: 'exact', path: '/api/...', handler })` 挂载路由；
  - 结合 `ctx.effect()` 实现热重载时的无缝销毁与清理。

### 形态 C：Web 客户端界面插件（Client UI Slot Plugin）
- **代表案例**：`dsh-git-gui-plugin` 的前端部分、自定义主题插件。
- **核心目的**：向 DSH Web 客户端的用户界面注入可视组件（如顶部状态徽章、侧边栏按钮、全局侧拉抽屉、弹窗等）。
- **技术要点**：
  - 导出独立的 `./client` 入口（打包产物通常为 `lib/client.js`）；
  - 声明注入 `slots` 和 `locale` 服务；
  - 使用 `ctx.slots.inject()` 和 `ctx.slots.register()` 挂载 React 组件；
  - 使用 `ctx.locale.register()` 提供中英多语言字典。

---

## 三、核心 API 与关键约定

### 3.1 Cordis 插件生命周期规约
每个 DSH 插件模块必须符合以下导出规范：
```typescript
import type { Context } from '@deepseek-ai/cordis';

// 1. 插件唯一标识符
export const name = 'dsh-plugin-example';

// 2. 声明需要的系统服务（若依赖未就绪，apply 不会被执行）
export const inject = ['tools', 'webServer'];

// 3. 插件装载入口
export function apply(ctx: Context, config: ExampleConfig): void {
  // 执行初始化逻辑
  
  // 4. 声明生命周期清理函数（当插件热重载或禁用时执行）
  ctx.effect(() => {
    return () => {
      // 释放资源、注销事件
    };
  }, 'example: cleanup resources');
}
```

### 3.2 动态配置模式（Schemastery）
DSH 推荐使用 `@deepseek-ai/schemastery`（即 `z`）声明插件的配置模式。这允许用户在 `settings.yaml` 或 WebUI 配置面板中获得自动类型校验与默认值：
```typescript
import z from '@deepseek-ai/schemastery';

export interface PluginConfig {
  apiKey?: string;
  enableFeature: boolean;
  timeout: number;
}

export const Config = z.object({
  apiKey: z.string().description('API 认证密钥'),
  enableFeature: z.boolean().default(true).description('是否启用高级功能'),
  timeout: z.number().default(5000).description('请求超时时间（毫秒）'),
});
```

### 3.3 工具注册规范（defineTool）
借助 `dsh-tools`，向 AI 模型注册一个新工具：
```typescript
import { defineTool } from '@deepseek-ai/dsh-tools';

ctx.tools.register(defineTool({
  name: 'my_custom_tool',
  description: '工具描述：清晰说明本工具适用的场景及参数含义，方便模型做出决策',
  parameters: {
    target: {
      type: 'string',
      required: true,
      description: '目标名称',
    },
    count: {
      type: 'integer',
      description: '可选参数：执行次数（默认 1）',
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
    // 将工具执行结果转换为对话上下文中给模型阅读的文本块
    render: (_args, result) => [{
      type: 'text',
      text: `执行结果: ${result.message} (状态: ${result.success})`,
    }],
  },
  async execute(args, exec) {
    // exec.signal 可以用于中断正在运行的操作
    return {
      success: true,
      message: `成功处理了 ${args.target}`,
    };
  },
}));
```

### 3.4 前端插槽体系（Slots System）
Web 端通过插槽实现灵活注入。常见插槽点（Slot IDs）包括：
- `conversation.session.header.actions`：对话窗口顶部工具栏区域（适合放状态徽章、快捷操作按钮）；
- `sidebar.footer.action`：左侧边栏底部操作区；
- `shell.overlay`：全局覆盖层（适合放抽屉侧拉栏、全局 Modal 弹窗）；
- `chat.input.addon`：输入框附件区域。

前端注入模板代码：
```typescript
export const inject = ['slots', 'locale'];

export function apply(ctx: any): void {
  // 注入顶部会话栏操作按钮
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'my-plugin-header-pill',
        order: 20, // 决定摆放顺序
        locale: 'my-plugin',
      },
      MyHeaderButtonComponent,
    ),
  );
}
```

### 3.5 打包契约与 cordis.patch.yml
为了让 DSH 能够识别插件的运行时结构，需要在项目根目录放置一个 `cordis.patch.yml` 文件：
```yaml
- insert:
    - id: my-plugin-id
      name: my-plugin-npm-package-name
```
该文件告知 DSH 的微内核 Cordis 在启动时将本插件注入运行时链路中。

---

## 四、实战演练：从零开发一个完整插件

接下来我们将构建一个名为 `dsh-plugin-pomodoro`（番茄钟与专注提醒助手）的完整插件，它包含：
1. **LLM 工具**：允许 AI 启动番茄钟、查询剩余时间；
2. **后端 API**：提供时钟倒计时后台管理；
3. **WebUI 组件**：在 DSH 顶部工具栏显示专注倒计时进度条。

### 4.1 项目结构设计
```text
dsh-plugin-pomodoro/
├── package.json               # 核心清单与 exports 声明
├── tsconfig.json              # TypeScript 编译配置
├── cordis.patch.yml           # Cordis 微内核挂载补丁
├── README.md                  # 插件说明文档
├── src/
│   ├── index.ts               # 后端入口（Cordis 插件、API 与 LLM 工具注册）
│   ├── types.ts               # 类型定义
│   └── client/                # 前端 WebUI 模块
│       ├── index.ts           # 客户端入口（Slots 注入与 i18n）
│       ├── PomodoroPill.tsx   # 顶部栏 React 状态组件
│       ├── PomodoroDrawer.tsx # 详情抽屉面板
│       └── locales.ts         # 中英双语文本
└── lib/                       # 编译构建输出目录（由 tsdown 产出）
    ├── index.js
    ├── index.d.ts
    └── client.js
```

### 4.2 编写 package.json 与构建配置
```json
{
  "name": "dsh-plugin-pomodoro",
  "version": "0.1.0",
  "description": "Pomodoro timer and focus assistant plugin for DeepSeek Harness",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "default": "./lib/index.js"
    },
    "./client": {
      "browser": "./lib/client.js",
      "default": "./lib/client.js"
    },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-slots"
      ],
      "platform": "web"
    },
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "files": [
    "lib",
    "cordis.patch.yml",
    "README.md"
  ],
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/dsh-host-webserver": "*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "tsdown": "^0.23.0",
    "typescript": "^5.6.0"
  },
  "license": "MIT"
}
```

### 4.3 编写 Cordis 装配清单 cordis.patch.yml
```yaml
- insert:
    - id: pomodoro
      name: dsh-plugin-pomodoro
```

### 4.4 编写后端入口与自定义工具（Node.js 端）
在 `src/index.ts` 中实现工具与 API 路由：
```typescript
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'dsh-plugin-pomodoro';
export const inject = ['tools', 'webServer'];

let timerEnd: number | null = null;
let timerTask = '';

export function apply(ctx: any): void {
  // 1. 注册面向 LLM 的工具：start_pomodoro
  ctx.tools.register(defineTool({
    name: 'start_pomodoro',
    description: '启动一个番茄专注倒计时时钟',
    parameters: {
      task: { type: 'string', required: true, description: '专注任务描述' },
      minutes: { type: 'integer', description: '专注分钟数（默认 25 分钟）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, text) => [{ type: 'text', text }],
    },
    async execute(args) {
      const minutes = args.minutes ?? 25;
      timerTask = args.task;
      timerEnd = Date.now() + minutes * 60 * 1000;
      return `已为你开启【${timerTask}】的番茄时钟，时长为 ${minutes} 分钟！`;
    },
  }));

  // 2. 注册面向 Web 端请求的 HTTP API
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: '/api/pomodoro/status',
    handler: async (req: any, res: any) => {
      const remainingSeconds = timerEnd ? Math.max(0, Math.floor((timerEnd - Date.now()) / 1000)) : 0;
      const data = {
        active: remainingSeconds > 0,
        task: timerTask,
        remainingSeconds,
      };
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
    },
  });

  // 3. 释放清理
  ctx.effect(() => () => unregister(), 'pomodoro: unregister api routes');
}
```

### 4.5 编写 WebUI 客户端扩展（React / TypeScript 端）
在 `src/client/index.ts` 中完成前端插槽注册：
```typescript
import React, { useEffect, useState } from 'react';

export const NS = 'pomodoro';
export const inject = ['slots', 'locale'];

function PomodoroHeaderPill() {
  const [status, setStatus] = useState({ active: false, remainingSeconds: 0, task: '' });

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/pomodoro/status');
        const json = await res.json();
        setStatus(json);
      } catch {}
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!status.active) return null;

  const min = Math.floor(status.remainingSeconds / 60);
  const sec = status.remainingSeconds % 60;

  return React.createElement(
    'div',
    {
      style: {
        padding: '2px 8px',
        backgroundColor: '#ef4444',
        color: '#fff',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 'bold',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      },
    },
    `🍅 ${status.task}: ${min}:${sec < 10 ? '0' : ''}${sec}`,
  );
}

export function apply(ctx: any): void {
  // 注入会话窗口顶部的操作栏
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'pomodoro-header-pill',
        order: 10,
        locale: NS,
      },
      PomodoroHeaderPill,
    ),
  );
}
```

---

## 五、插件调试、部署与常见踩坑指南

### 5.1 本地联调与注册方法
开发中的插件无需频繁打包发布至 npm，推荐使用本地软链接进行热联调：

1. **进入插件目录编译产物**：
   ```bash
   pnpm run build
   # 或保持监听构建
   pnpm run dev
   ```
2. **在 DSH 运行时 Profile 中引入**：
   在 `C:\Users\<用户名>\.dsh\profiles\web\package.json` 的 `dependencies` 中添加软链接：
   ```json
   {
     "dependencies": {
       "dsh-plugin-pomodoro": "link:D:/path/to/dsh-plugin-pomodoro"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "...",
           "dsh-plugin-pomodoro"
         ]
       }
     }
   }
   ```
3. 重启 DSH Desktop 或刷新 Web 界面即可加载。

### 5.2 避坑要点：安全沙箱与文件观察策略
- **FS_NOT_OBSERVED（文件未观察禁止盲改）**：DSH 实施严格的文件安全保护。编写使用文件系统的工具时，修改文件前**必须先读取文件**以建立版本快照，否则会被内核拦截。
- **路径逃逸（Path Escapes）**：插件操作本地文件时，必须严格通过 `path.resolve` 检查路径是否超出用户工作区边界，严禁直接拼接不可信的相对路径。

### 5.3 避坑要点：热更新 (HMR) 机制
- 浏览器客户端插件在代码变动后，若希望在 Web 页面不刷新的情况下实时生效，必须保持打包工具的增量编译输出（如 `tsdown --watch`）。
- 服务端逻辑（API 路由与 Agent 工具）发生结构性变更时，推荐彻底重启一次 DSH 进程以确保 Cordis 服务图谱完整重建。
