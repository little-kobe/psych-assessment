-- 第8轮：问卷组合、题目图片视频、总分算法、常模
-- 在 Navicat 里选中 psych_assessment 数据库后执行（只新增字段和表，不改动已有数据）

-- 1. 问卷组合：一个链接依次作答多份问卷（bundles 表早就建好了，这里补几个字段）
ALTER TABLE `bundles`
  ADD COLUMN `consent_text` text NULL COMMENT '知情同意说明，不填用默认文字',
  ADD COLUMN `shuffle` tinyint(1) NULL DEFAULT 0 COMMENT '每人随机打乱问卷顺序（平衡顺序效应）';

ALTER TABLE `submissions`
  ADD COLUMN `bundle_id` int NULL DEFAULT NULL COMMENT '通过哪个问卷组合提交，NULL 表示单独的问卷链接',
  ADD COLUMN `bundle_token` varchar(40) NULL DEFAULT NULL COMMENT '同一个人在一次组合作答中的几份问卷共用这个标记',
  ADD COLUMN `bundle_position` int NULL DEFAULT NULL COMMENT '这份问卷是他在组合里作答的第几份',
  ADD INDEX `bundle_token` (`bundle_token`);

-- 2. 总分算法：dimensions 各维度得分相加（原来的方式）；items_sum 维度里的题每题只算一次相加；items_mean 取平均
ALTER TABLE `questionnaires`
  ADD COLUMN `total_formula` varchar(20) NULL DEFAULT 'dimensions' COMMENT '总分算法',
  ADD COLUMN `norm_in_report` tinyint(1) NULL DEFAULT 0 COMMENT '受测者结果图表里是否显示常模平均';

-- 3. 题目图片、视频、音频（选项图片存在 options 里，不需要新字段）
ALTER TABLE `questions`
  ADD COLUMN `media` json NULL COMMENT '题目上方显示的图片/视频/音频，如[{"type":"image","url":"/uploads/xx.jpg"}]';

-- 4. 常模：可以按性别、年级等录入多套均值和标准差
CREATE TABLE IF NOT EXISTS `norms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '所属问卷',
  `name` varchar(100) NOT NULL COMMENT '常模名称，如 全国常模、男生',
  `source` varchar(500) NULL DEFAULT NULL COMMENT '来源说明，如 出处文献',
  `conditions` json NULL COMMENT '适用条件，空表示所有人，如[{"field_key":"gender","op":"eq","value":"男"}]',
  `norm_values` json NOT NULL COMMENT '各指标的均值和标准差，如{"total":{"mean":1.5,"sd":0.4}}',
  `order_num` int NULL DEFAULT 1,
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `questionnaire_id` (`questionnaire_id`),
  CONSTRAINT `norms_questionnaire_fk` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
