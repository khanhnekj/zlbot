import { appContext } from "../context.js";
import { logMessageToFile } from "../../utils/core/io-json.js";

export const GroupEventType = {
  JOIN_REQUEST: "join_request",
  JOIN: "join",
  LEAVE: "leave",
  REMOVE_MEMBER: "remove_member",
  BLOCK_MEMBER: "block_member",
  UPDATE_SETTING: "update_setting",
  UPDATE: "update",
  NEW_LINK: "new_link",
  ADD_ADMIN: "add_admin",
  REMOVE_ADMIN: "remove_admin",
  NEW_PIN_TOPIC: "new_pin_topic",
  UPDATE_PIN_TOPIC: "update_pin_topic",
  REORDER_PIN_TOPIC: "reorder_pin_topic",
  UPDATE_BOARD: "update_board",
  REMOVE_BOARD: "remove_board",
  UPDATE_TOPIC: "update_topic",
  UNPIN_TOPIC: "unpin_topic",
  REMOVE_TOPIC: "remove_topic",
  ACCEPT_REMIND: "accept_remind",
  REJECT_REMIND: "reject_remind",
  REMIND_TOPIC: "remind_topic",
  UPDATE_AVATAR: "update_avatar",
  UNKNOWN: "unknown",
};

export function initializeGroupEvent(data, type, act) {
  const threadId = "group_id" in data ? data.group_id : data.groupId;

  if (type === GroupEventType.JOIN_REQUEST) {
    return { type, act, data: data, threadId, isSelf: false };
  } else if (
    type === GroupEventType.NEW_PIN_TOPIC ||
    type === GroupEventType.UNPIN_TOPIC ||
    type === GroupEventType.UPDATE_PIN_TOPIC
  ) {
    return {
      type,
      act,
      data: data,
      threadId,
      isSelf: data.actorId === appContext.uid,
    };
  } else if (type === GroupEventType.REORDER_PIN_TOPIC) {
    return {
      type,
      act,
      data: data,
      threadId,
      isSelf: data.actorId === appContext.uid,
    };
  } else if (type === GroupEventType.UPDATE_BOARD || type === GroupEventType.REMOVE_BOARD) {
    return {
      type,
      act,
      data: data,
      threadId,
      isSelf: data.sourceId === appContext.uid,
    };
  } else if (type === GroupEventType.ACCEPT_REMIND || type === GroupEventType.REJECT_REMIND) {
    return {
      type,
      act,
      data: data,
      threadId,
      isSelf: Array.isArray(data.updateMembers) && data.updateMembers.some((memberId) => memberId === appContext.uid),
    };
  } else if (type === GroupEventType.REMIND_TOPIC) {
    return {
      type,
      act,
      data: data,
      threadId,
      isSelf: data.creatorId === appContext.uid,
    };
  } else {
    const baseData = data;
    logMessageToFile(
      `${data.groupName}\nType Sự Kiện: ${type} - Số Lượng Member Trong Sự Kiện: ${baseData.updateMembers ? baseData.updateMembers.length : 0}\n`,
      "group"
    );
    return {
      type,
      act,
      data: baseData,
      threadId,
      isSelf:
        (Array.isArray(baseData.updateMembers) && baseData.updateMembers.some((member) => member.id === appContext.uid)) ||
        baseData.sourceId === appContext.uid,
    };
  }
}
