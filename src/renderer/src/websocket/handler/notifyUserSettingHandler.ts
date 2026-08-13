// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUBLISH, UN } from "../../constant";
import Logger from "../utils/logger";

/**
 * UN：服务端告知「你的设置变了」，body 是 {"head":"<version>"}。
 * 这里不解析 head —— 直接触发一次增量拉取，由 UG 应答带回真正的数据。
 * 发起修改的那台设备也会收到自己的 UN，多拉一次是幂等的。
 */
export default class NotifyUserSettingHandler extends AbstractMessageHandler{
    match(proto){
        return proto.signal == PUBLISH && proto.subSignal == UN;
    }

    processMessage(proto){
        Logger.log("NotifyUserSettingHandler " + proto.content);
        this.vueWebsocket.getUserSettings();
    }
}
