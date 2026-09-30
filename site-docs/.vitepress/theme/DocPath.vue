<script setup>
defineProps({ steps: { type: Array, required: true } });
</script>

<template>
  <ol class="doc-path" aria-label="Workflow at a glance">
    <li v-for="(step, index) in steps" :key="step">
      <span class="doc-path-number" aria-hidden="true">{{ index + 1 }}</span>
      <strong>{{ step }}</strong>
      <svg v-if="index < steps.length - 1" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12h15m-6-6 6 6-6 6" />
      </svg>
    </li>
  </ol>
</template>
