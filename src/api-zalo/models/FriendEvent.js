import { appContext } from "../context.js";

export const FriendEventType = {
  ADD: 0,
  REMOVE: 1,
  REQUEST: 2,
  UNDO_REQUEST: 3,
  REJECT_REQUEST: 4,
  SEEN_FRIEND_REQUEST: 5,
  BLOCK: 6,
  UNBLOCK: 7,
  BLOCK_CALL: 8,
  UNBLOCK_CALL: 9,
  PIN_UNPIN: 10,
  PIN_CREATE: 11,
  UNKNOWN: 12,
};

export function initializeFriendEvent(data, type) {
  const uid = appContext.uid;

  if (
    type === FriendEventType.ADD ||
    type === FriendEventType.REMOVE ||
    type === FriendEventType.BLOCK ||
    type === FriendEventType.UNBLOCK ||
    type === FriendEventType.BLOCK_CALL ||
    type === FriendEventType.UNBLOCK_CALL
  ) {
    return {
      type,
      data: data,
      threadId: data,
      isSelf: ![FriendEventType.ADD, FriendEventType.REMOVE].includes(type),
    };
  } else if (type === FriendEventType.REJECT_REQUEST || type === FriendEventType.UNDO_REQUEST) {
    const threadId = data.toUid;
    return {
      type,
      data: data,
      threadId,
      isSelf: data.fromUid === uid,
    };
  } else if (type === FriendEventType.REQUEST) {
    const threadId = data.toUid;
    return {
      type,
      data: data,
      threadId,
      isSelf: data.fromUid === uid,
    };
  } else if (type === FriendEventType.SEEN_FRIEND_REQUEST) {
    return {
      type,
      data: data,
      threadId: uid,
      isSelf: true,
    };
  } else if (type === FriendEventType.PIN_CREATE) {
    const threadId = data.conversationId;
    return {
      type,
      data: data,
      threadId,
      isSelf: data.actorId === uid,
    };
  } else if (type === FriendEventType.PIN_UNPIN) {
    const threadId = data.conversationId;
    return {
      type,
      data: data,
      threadId,
      isSelf: data.actorId === uid,
    };
  } else {
    return {
      type: FriendEventType.UNKNOWN,
      data: JSON.stringify(data),
      threadId: "",
      isSelf: false,
    };
  }
}
