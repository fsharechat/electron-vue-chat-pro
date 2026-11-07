// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUBLISH, MN } from "../../constant";

export default class NotifyMessageHandler extends AbstractMessageHandler{
    match(proto){
        return proto.signal == PUBLISH && proto.subSignal == MN;
    }

    processMessage(proto){
        console.log("notifymessage "+proto.content);
        let notify = JSON.parse(proto.content);
        console.log("notify messageHead "+notify.messageHead+" notify type "+notify.type);
        // 通知只触发补拉，不能在消息落盘前推进接收游标。
        this.vueWebsocket.pullMessage(notify.messageHead,notify.type,1);
    }
}
