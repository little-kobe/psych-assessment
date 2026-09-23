-- 第7轮：答完后是否给受测者看结果图表（默认关闭，研究型问卷通常不给被试反馈）
ALTER TABLE `questionnaires`
  ADD COLUMN `show_report_chart` tinyint(1) NULL DEFAULT 0 COMMENT '答完后是否向受测者展示维度得分图表';