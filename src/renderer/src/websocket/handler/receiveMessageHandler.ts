// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { MP, PUB_ACK } from "../../constant";
import Message from "../message/message";
import ProtoMessage from "../message/protomessage";
import ProtoConversationInfo from '../model/protoConversationInfo'
import LocalStore from "../store/localstore";
import UnreadCount from "../model/unReadCount";
import MessageConfig from "../message/messageConfig";
import PersistFlag from "../message/persistFlag";
import ChatManager from "../chatManager";
import ConversationType from "../model/conversationType";

export default class ReceiveMessageHandler extends AbstractMessageHandler {
      conversations = [];

      match(proto){
        return proto.signal == PUB_ACK && proto.subSignal == MP;
      }

      processMessage(proto){
        LocalStore.resetSendMessageCount();
        var content = JSON.parse(proto.content);
        console.log("current "+content.current+" head "+content.head+" messageCount "+content.messageCount);
        if(content.messageCount == 0){
          this.vueWebsocket.sendAction('changeEmptyMessageState',true);
        } else {
          this.vueWebsocket.sendAction('changeEmptyMessageState',false);
        }
        for(var protoMessage of content.messageResponseList){
          var protoMessage = ProtoMessage.toProtoMessage(protoMessage);
          if(MessageConfig.isDisplayableMessage(protoMessage)){
            this.computeGroupSendMessageUsers(protoMessage)
            this.addProtoMessage(protoMessage);
            this.uploadReport(protoMessage)
          }
          ChatManager.onReceiveMessage(protoMessage);
        } 
        this.vueWebsocket.sendAction('changetFirstLogin',false);
        this.vueWebsocket.sendAction('syncGroupInfos', null);
        this.vueWebsocket.sendAction('syncUserInfos', null);
      }

      addProtoMessage(protoMessage){
         this.vueWebsocket.sendAction('addProtoMessage',protoMessage);
      }

      /**
       * 只上报单聊用户的送达回执
       * @param  protoMessage 
       */
      uploadReport(protoMessage){
        // if(protoMessage.direction == 1){
        //   if(protoMessage.conversationType == ConversationType.Single){
        //     var currentTime = new Date().getTime();
        //     this.vueWebsocket.uploadDeliveryReport(currentTime,protoMessage.target)
        //   }
        // }
        this.vueWebsocket.sendAction('uploadReport',protoMessage)
      }

      /**
       * 统计群组发送消息的用户列表
       */
      computeGroupSendMessageUsers(protoMessage){
         if(protoMessage.direction == 1 && protoMessage.conversationType == ConversationType.Group){
            this.vueWebsocket.sendAction('addGroupSendUser',{
              from: protoMessage.from,
              target: protoMessage.target
            })
         }
      }
}