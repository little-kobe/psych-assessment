-- 第6轮：分数段可以针对某个维度（dimension_id 为空 = 按总分匹配，和以前一样）
ALTER TABLE `score_rules`
  ADD COLUMN `dimension_id` int NULL DEFAULT NULL COMMENT '适用的维度，NULL 表示按总分',
  ADD INDEX `dimension_id`(`dimension_id`),
  ADD CONSTRAINT `score_rules_dimension_fk` FOREIGN KEY (`dimension_id`) REFERENCES `dimensions` (`id`) ON DELETE CASCADE;