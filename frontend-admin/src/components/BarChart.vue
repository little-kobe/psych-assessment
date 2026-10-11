<script setup>
// 简单柱状图组件（统计分析页用）：传入横轴分类和每根柱子的数值即可
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// 只引入用得到的部分，打包体积小一些
echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

const props = defineProps({
  categories: { type: Array, required: true }, // 横轴上的名称
  values: { type: Array, required: true }, // 每根柱子的数值
  color: { type: String, default: "#d9692f" }, // 柱子颜色
  colors: { type: Array, default: null }, // 每根柱子单独指定颜色（可选）
  yName: { type: String, default: "" }, // 纵轴名称，如「人数」
  integer: { type: Boolean, default: true }, // 纵轴只显示整数（人数用）
  tooltip: { type: Function, default: null }, // (第几根柱子) => 提示文字
  height: { type: Number, default: 240 },
});

const el = ref(null);
let chart = null;

function render() {
  if (!chart) return;
  chart.setOption(
    {
      grid: { left: 48, right: 16, top: 30, bottom: 32 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { opacity: 0.08 } },
        formatter: (params) => {
          const i = params[0].dataIndex;
          return props.tooltip
            ? props.tooltip(i)
            : `${params[0].name}：${params[0].value}`;
        },
      },
      xAxis: {
        type: "category",
        data: props.categories,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#d9d9d9" } },
        axisLabel: { color: "#666", hideOverlap: true },
      },
      yAxis: {
        type: "value",
        name: props.yName,
        nameTextStyle: { color: "#999", align: "right" },
        minInterval: props.integer ? 1 : 0,
        splitLine: { lineStyle: { color: "#eeeeee" } },
        axisLabel: { color: "#999" },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 24,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          data: props.values.map((v, i) => ({
            value: v,
            itemStyle: { color: props.colors ? props.colors[i] : props.color },
          })),
        },
      ],
    },
    true,
  );
}

function resize() {
  if (chart) chart.resize();
}

onMounted(() => {
  chart = echarts.init(el.value);
  render();
  window.addEventListener("resize", resize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resize);
  if (chart) chart.dispose();
});

// 数据变了就重画
watch(() => [props.categories, props.values, props.colors], render, {
  deep: true,
});
</script>

<template>
  <div ref="el" :style="{ width: '100%', height: height + 'px' }"></div>
</template>
