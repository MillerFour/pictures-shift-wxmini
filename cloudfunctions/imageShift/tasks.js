'use strict';
const cloud = require('wx-server-sdk');

const db = cloud.database();
const _ = db.command;
const TASKS = 'tasks';

function collection() {
  return db.collection(TASKS);
}

/** 新建任务，返回 _id（即 taskId） */
async function create({ styleId, sourceFileID, openid }) {
  const now = Date.now();
  const res = await collection().add({
    data: {
      status: 'PENDING',
      styleId,
      sourceFileID,
      openid: openid || '',
      errorMessage: '',
      resultFileID: '',
      vendorTaskId: '',
      createdAt: now,
      updatedAt: now,
      finishedAt: 0,
    },
  });
  return res._id;
}

async function get(taskId) {
  const res = await collection().doc(taskId).get();
  return res.data; // undefined if not found
}

/**
 * 抢占任务：只有处于 PENDING/RUNNING 才更新成 RUNNING，返回是否抢到。
 * 用乐观更新保证同一任务只被一个实例（create 或 worker）执行，避免双跑。
 */
async function claim(taskId) {
  const res = await collection()
    .where({ _id: taskId, status: _.in(['PENDING', 'RUNNING']) })
    .update({ data: { status: 'RUNNING', updatedAt: Date.now() } });
  return res.stats.updated === 1;
}

async function patch(taskId, data) {
  await collection().doc(taskId).update({ data: { ...data, updatedAt: Date.now() } });
}

/** 找出待处理或卡死（长时间未更新）的任务，交给 worker 续跑 */
async function pendingOrStuck(ttlMs) {
  const cutoff = Date.now() - ttlMs;
  const res = await collection()
    .where(
      _.or([
        { status: 'PENDING' },
        _.and([{ status: 'RUNNING' }, { updatedAt: _.lt(cutoff) }]),
      ]),
    )
    .limit(20)
    .get();
  return res.data || [];
}

module.exports = { create, get, claim, patch, pendingOrStuck };
