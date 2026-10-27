# 奥术摸鱼大师 · Arcane Reelax

一款以海洋、鱼获与装备养成为核心的网页钓鱼游戏。

在线体验：[https://reelax.cn](https://reelax.cn)

## 游戏内容

- 自动逐杆钓鱼、在线与离线收益、天气变化和 17 张水域地图
- 1122 种鱼获、九级稀有度、图鉴、专精目标、成就与称号
- 鱼竿、鱼饵、装备、背包、商店、道具市场、鱼类市场和以物易物
- 属性分配、转生、永久天赋、魔法石培养与装备工坊
- 每日任务、每日签到、签到榜、个人赛、公会赛和周赛商店
- 组队船、公会、世界首领、渊潮围猎、灯塔祈愿与神器收藏
- 注册登录、邮箱验证、密码找回、个人资料与展示柜
- 完整管理后台，可管理玩家、游戏内容、市场、公告、站点参数、邮件和审计记录

## 本地运行

需要安装 Node.js 20+、Docker 和 npm。

```bash
docker compose up -d
npm install
npm run db:migrate -w server
npm run seed
npm run dev
```

启动后可访问：

- 游戏：<http://localhost:3000>
- 管理后台：<http://localhost:3000/admin>
- 运行状态：<http://localhost:3000/api/health>

## 初始配置

复制环境变量模板：

```bash
copy .env.example .env
```

在 `.env` 中填写：

```env
DATABASE_URL=postgres://reelax:reelax_dev@localhost:5432/reelax
PORT=3000
NODE_ENV=development

ADMIN_USERNAME=admin
ADMIN_PASSWORD=设置一个安全的管理员密码
ADMIN_SESSION_SECRET=设置一个足够长的随机密钥

TEST_USER_EMAIL=测试账号邮箱
TEST_USER_PASSWORD=测试账号密码
EMAIL_VERIFICATION_CODE=123456
```

`npm run seed` 会在配置了 `TEST_USER_EMAIL` 和 `TEST_USER_PASSWORD` 时创建本地测试账号。开发环境邮箱验证码默认为 `123456`。

## 管理后台

管理后台包含：

- 玩家查询、资源发放、等级调整、改名、封禁和密码重置
- 鱼种、地图、公告、天气、全局增益和排行榜管理
- 市场订单、社交数据和运营数据查看
- 游戏名称、QQ 群、客服邮箱、备案信息、注册策略和 SMTP 邮件配置
- 管理操作审计

SMTP 配置完成后，注册验证、邮箱验证和密码找回会直接发送邮件。

## 生产运行

```bash
npm run build
npm start
```

生产环境请使用独立的数据库密码、管理员密码和会话密钥，并正确配置 HTTPS、域名与邮件服务。

## 检查

```bash
npm test
npm run audit:ui
```

检查内容包括游戏素材、页面路由、主要交互、页面错误与接口异常。

## 版权说明

项目中的游戏名称、品牌、美术素材与玩法内容归原作者所有。公开代码仅用于项目展示、交流与继续维护。
