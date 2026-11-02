-- 第16轮：账号分三级
--   admin      总账号：看到、管理所有问卷和所有账号（新建导师、研究者，给研究者分配导师）
--   supervisor 导师：看到、管理自己和名下研究者的问卷；只管理自己名下的研究者
--   researcher 研究者：只看自己的问卷
-- 研究者属于哪个导师记在 supervisor_id 里（一个研究者最多属于一个导师）。
-- 原来的「导师」账号能看所有人的数据，升级后改成总账号，权限不变；原来的研究者先都是「未分配」。
-- 只执行一次（再执行会报 Duplicate column，不影响数据）。

SET NAMES utf8mb4;

ALTER TABLE `admins`
  ADD COLUMN `supervisor_id` int NULL DEFAULT NULL COMMENT '研究者所属的导师（admins.id）；导师和总账号为空' AFTER `role`,
  ADD KEY `supervisor_id` (`supervisor_id`),
  ADD CONSTRAINT `admins_supervisor_fk` FOREIGN KEY (`supervisor_id`) REFERENCES `admins` (`id`) ON DELETE SET NULL;

UPDATE `admins` SET `role` = 'admin' WHERE `role` = 'supervisor';
-- 初始账号的默认姓名「导师账号」改成「总账号」（改过姓名的不动）
UPDATE `admins` SET `display_name` = '总账号' WHERE `role` = 'admin' AND `display_name` = '导师账号';

ALTER TABLE `admins`
  MODIFY `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'researcher' COMMENT '角色：admin 总账号（管理所有人），supervisor 导师（管理名下研究者），researcher 研究者';
