// @ts-nocheck
import { CONNECT_ACK } from "../../constant";
import AbstractMessageHandler from "./abstractmessagehandler";
import LocalStore from "../store/localstore";
import { useUserSettingStore } from "../../stores/useUserSettingStore";

/**
 * 是否需要拉取用户设置。服务端 2.2.12 之前不下发 settingHead，取到 undefined 时不拉。
 * 严格大于：相等说明本地已是最新，服务端为 0 说明它确实没有任何设置。
 */
export function shouldPullUserSettings(serverSettingHead, localVersion){
    const head = Number(serverSettingHead);
    if(!Number.isFinite(head)){
        return false;
    }
    return head > Number(localVersion || 0);
}

export default class ConnectAckHandler extends AbstractMessageHandler{
    constructor(vueWebsocket){
         super(vueWebsocket);
    }
    match(protoObj){
        return protoObj.signal == CONNECT_ACK;
    }

    processMessage(data){
        console.log("ConnectAckHandler process message");
        var connectAcceptedMessage = JSON.parse(data.content);
        console.log("connectAcceptedMessage friendHead "+connectAcceptedMessage.friendHead+" messageHead "+connectAcceptedMessage.messageHead);
        //拉取朋友列表
        this.vueWebsocket.getFriend();
        //用户设置：保存的群组、会话置顶、会话免打扰
        const settingStore = useUserSettingStore();
        if(shouldPullUserSettings(connectAcceptedMessage.settingHead, settingStore.version)){
            this.vueWebsocket.getUserSettings(settingStore.version);
        }
        let lastMessageSeq = LocalStore.getLastMessageSeq();
        if(!lastMessageSeq){
            lastMessageSeq = '0';
            this.vueWebsocket.sendAction('changetFirstLogin',true);
        } else {
            this.vueWebsocket.sendAction('changetFirstLogin',false);
        }
        //好友请求信息
        this.vueWebsocket.getFriendRequest(LocalStore.getFriendRequestVersion());
        //初始拉取消息列表
        this.vueWebsocket.pullMessage(lastMessageSeq,0,0,LocalStore.getSendMessageCount());
        LocalStore.setLastMessageSeq(connectAcceptedMessage.messageHead);
    }
}