# 用户设置同步（electron）端到端验证清单

需要服务端 2.2.12-SNAPSHOT（`push-group` 先于 `push-connector`）已部署。
用 `npm run dev` 起开发版，开发者工具 Console 里观察日志。

| # | 操作 | 预期 |
|---|---|---|
| 1 | 群详情页打开「保存到通讯录」 | 好友 tab →「群聊」里出现该群；Console 有 UP 发送日志 |
| 2 | 刷新窗口（Cmd+R） | 群仍在列表里（localStorage 持久化） |
| 3 | **清空 localStorage 后重新登录** | 日志出现 UG 拉取；好友 tab →「群聊」完整恢复；这是本功能的核心场景 |
| 4 | 右键会话选「消息免打扰」，再右键 | 菜单变为「取消免打扰」 |
| 5 | **清空 localStorage 后重新登录** | 之前置顶/免打扰过的会话，在会话列表重建后仍带正确状态（新建会话从设置派生） |
| 6 | 同账号在手机端改任一设置 | electron 收到 UN 后自动拉取并更新界面 |
| 7 | 群详情页关闭「保存到通讯录」，清 localStorage 重登 | 该群不再出现（服务端返回 tombstone `"0"`） |
| 8 | **登出后用第二个账号登录** | 「群聊」显示第二个账号的群，不是第一个账号的 |
| 9 | **前置**：electron 已登录且已同步过设置（本地 version 非零，可先执行第 1 条产生一次同步）。关闭 electron（或断网），保持 electron 已登录、**不清 localStorage**；在手机端修改任一设置（置顶/免打扰/保存群组任一）；重新打开 electron（或恢复网络并等待重连） | 日志出现一次携带非零本地 version 的 UG 拉取（`shouldPullUserSettings` 判定「本地非零但落后于 settingHead」这一分支，与第 3/5/7 条「version 归零」是不同代码路径）；服务端只回增量条目；手机端的改动在 electron 界面上补齐 |

第 3、5、8、9 条是最容易出问题的四条。第 8 条 android 端曾有数据泄漏 bug；第 9 条是「离线期间对端修改、重新上线后补齐」的核心恢复时序，version 为 0 时（第 3/5/7 条）判定逻辑几乎必然拉取、无法证伪，只有本地 version 非零这条路径能真正验证 `shouldPullUserSettings` 的判定分支。

## 备注（非本次范围，记录供后续参考）

`LocalStore.clearLocalStore()`（`websocket/store/localstore.ts:143`）登出时没有清 `"group_infos"` 这个 key，下次登录会被读回。这不是账号私有数据，也不经由 scope 6（保存到通讯录）驱动展示，不构成设置泄漏；影响仅是可能短暂显示陈旧的群名/头像，直到重新拉取覆盖。属于既有行为，不在本次用户设置同步功能范围内修复。
