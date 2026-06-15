// @ts-nocheck
export default class MessageReport{
    reportType;
    uid;
    date;
    target;

    static toMessageReport(jsonObj){
        var messageReport = new MessageReport();
        messageReport.uid = jsonObj.uid;
        messageReport.target = jsonObj.target;
        messageReport.reportType = jsonObj.reportType;
        messageReport.date = jsonObj.date;
        return messageReport;
    }

    // equal(targetMessageReport){
    //     if(this.reportType == targetMessageReport.reportType &&
    //         this.uid == targetMessageReport.uid &&
    //         this.target == targetMessageReport.target){
    //         return true
    //     } 
    //     return false;
    // }
}