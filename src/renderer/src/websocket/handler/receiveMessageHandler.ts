// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { MP, PUB_ACK } from "../../constant";
import Message from "../message/message";
import ProtoMessage from "../message/protomessage";
import ProtoConversationInfo from '../model/protoConversationInfo'
import UnreadCount from "../model/unReadCount";
import MessageConfig from "../message/messageConfig";
import PersistFlag from "../message/persistFlag";
import ChatManager from "../chatManager";
import ConversationType from "../model/conversationType";

export default class ReceiveMessageHandler extends AbstractMessageHandler {
      pendingMessages = [];
      processing = false;
      retryTimer = null;
      retryDelay = 1000;
      controller = new AbortController();

      match(proto){
        return proto.signal == PUB_ACK && proto.subSignal == MP;
      }

      processMessage(proto){
        if(this.controller.signal.aborted) return Promise.resolve(false);
        const task = { proto, messageIndex: 0, gapIndex: 0 };
        // 通话等透明直推不参与游标同步，不能被历史消息补拉的重试阻塞。
        try {
          task.content = JSON.parse(proto.content);
          if(String(task.content.head) === '0' && String(task.content.current) === '0'){
            return this.applyMessage(task).then(() => true, error => {
              console.warn('[MessageSync] 透明消息处理失败', error);
              return false;
            });
          }
        } catch(error) {
          console.warn('[MessageSync] 无效的消息应答', error);
          return Promise.resolve(false);
        }
        const completion = new Promise(resolve => { task.resolve = resolve; });
        this.pendingMessages.push(task);
        this.drainMessages();
        return completion;
      }

      async drainMessages(){
        if(this.processing || this.retryTimer || this.controller.signal.aborted) return;
        this.processing = true;
        try {
          while(this.pendingMessages.length && !this.controller.signal.aborted){
            const task = this.pendingMessages[0];
            try {
              await this.applyMessage(task);
              if(this.controller.signal.aborted) return;
              this.pendingMessages.shift();
              this.retryDelay = 1000;
              task.resolve(true);
            } catch(error){
              if(this.controller.signal.aborted) return;
              console.warn('[MessageSync] 消息同步失败，保留游标并重试', error);
              this.retryTimer = setTimeout(() => {
                this.retryTimer = null;
                this.drainMessages();
              }, this.retryDelay);
              this.retryDelay = Math.min(this.retryDelay * 2, 30000);
              return;
            }
          }
        } finally {
          this.processing = false;
        }
      }

      destroy(){
        this.controller.abort();
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
        for(const task of this.pendingMessages) task.resolve(false);
        this.pendingMessages = [];
      }

      async applyMessage(task){
        const content = task.content || (task.content = JSON.parse(task.proto.content));
        if(!Array.isArray(content.messageResponseList)) throw new Error('Invalid MP message list');
        console.log("current "+content.current+" head "+content.head+" messageCount "+content.messageCount);
        if(content.messageCount == 0){
          this.vueWebsocket.sendAction('changeEmptyMessageState',true);
        } else {
          this.vueWebsocket.sendAction('changeEmptyMessageState',false);
        }
        for(; task.messageIndex < content.messageResponseList.length; task.messageIndex++){
          var protoMessage = ProtoMessage.toProtoMessage(content.messageResponseList[task.messageIndex]);
          if(MessageConfig.isDisplayableMessage(protoMessage)){
            this.computeGroupSendMessageUsers(protoMessage)
            this.addProtoMessage(protoMessage);
            this.uploadReport(protoMessage)
          }
          ChatManager.onReceiveMessage(protoMessage);
        } 
        if(String(content.head) === '0' && String(content.current) === '0') return;
        // 服务端截断的会话：丢掉断层以下的缓存，往上翻时从断层处拉远程补齐
        const gaps = content.gapList || [];
        for(; task.gapIndex < gaps.length; task.gapIndex++){
          await this.vueWebsocket.sendAction('applyConversationGap', {
            ...gaps[task.gapIndex], signal: this.controller.signal
          });
          if(this.controller.signal.aborted) return;
        }
        // 仅在本轮已追到 head 且所有消息处理成功后提交；head=0 的透明信令由落盘层忽略。
        if(String(content.current) === String(content.head)){
          this.vueWebsocket.sendAction('commitMessageSync', content.head);
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
