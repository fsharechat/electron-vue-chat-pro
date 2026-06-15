// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUB_ACK, MDR } from "../../constant";

export default class DeliveryReportHandler extends AbstractMessageHandler {
    match(proto){
        return proto.signal == PUB_ACK && proto.subSignal == MDR;
    }
}