// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUB_ACK, MRN, PUBLISH } from "../../constant";

export default class NotifyMessageReportHandler extends AbstractMessageHandler {
    match(proto){
        return proto.signal == PUBLISH && proto.subSignal == MRN;
    }

    processMessage(proto){
        let notify = JSON.parse(proto.content);
        console.log("notify report messageHead "+notify.messageHead+" notify type "+notify.type);
        this.vueWebsocket.pullMessageReport(notify.messageHead,notify.type)
    }
}