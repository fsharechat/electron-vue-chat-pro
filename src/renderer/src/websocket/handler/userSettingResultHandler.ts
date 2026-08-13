// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUB_ACK, UG } from "../../constant";
import Logger from "../utils/logger";

/**
 * UG 应答：服务端只返回 updateDt 大于请求 version 的条目。
 * value 为 "0" 是 tombstone（表示该设置被取消），照常写进 store —— 读取方只认 "1"，
 * 写 "0" 与删除等价，还保留了「服务端说过它被取消」这个事实。
 */
export default class UserSettingResultHandler extends AbstractMessageHandler{
    match(proto){
        return proto.signal == PUB_ACK && proto.subSignal == UG;
    }

    processMessage(proto){
        if(!proto.content){
            Logger.log("UserSettingResultHandler empty content");
            return;
        }
        let entries;
        try {
            entries = JSON.parse(proto.content);
        } catch (e) {
            Logger.log("UserSettingResultHandler parse failed " + proto.content);
            return;
        }
        if(!Array.isArray(entries)){
            Logger.log("UserSettingResultHandler unexpected payload " + proto.content);
            return;
        }
        Logger.log("UserSettingResultHandler entries " + entries.length);
        this.vueWebsocket.sendAction("applyUserSettings", entries);
    }
}
