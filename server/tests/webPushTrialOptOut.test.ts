import {afterEach,describe,expect,it,vi} from "vitest";
const transport = vi.hoisted(()=>({sendNotification:vi.fn(async()=>({statusCode:201})),setVapidDetails:vi.fn()}));
vi.mock("web-push",()=>({default:transport}));
vi.mock("../_core/config",()=>({env:{}}));
vi.mock("../_core/db",()=>({getAllPushSubscriptions:vi.fn(),getPushSubscriptionsByUser:vi.fn(),deletePushSubscription:vi.fn()}));
import {sendPushToRoles} from "../services/notifications/webPush";
const subscribers=[{userId:1,endpoint:"https://push.invalid/test",p256dh:"test",auth:"test"}];
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe("outbound push trial opt-out",()=>{
  it("keeps acceptance workflows from sending external messages when disabled",async()=>{
    vi.stubEnv("WEB_PUSH_ENABLED","false");
    expect(await sendPushToRoles(subscribers,{title:"UAT",body:"test"})).toEqual({sent:0,failed:0});
    expect(transport.sendNotification).not.toHaveBeenCalled();
  });
  it("retains existing delivery when no opt-out is set",async()=>{
    vi.stubEnv("WEB_PUSH_ENABLED",undefined);
    expect(await sendPushToRoles(subscribers,{title:"existing",body:"test"})).toEqual({sent:1,failed:0});
    expect(transport.sendNotification).toHaveBeenCalledTimes(1);
  });
});
