<script setup lang="ts">
const emit = defineEmits<{ (e: 'pick', emoji: string): void }>()

const EMOJIS = [
  // 笑脸 & 情感
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃',
  '😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
  '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔',
  '🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥',
  '😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮',
  '🥵','🥶','😱','😨','😰','😥','😓','🤯','😤','😠',
  '😡','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺',
  '👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽',
  // 手势 & 身体
  '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞',
  '🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍',
  '👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝',
  '🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','🦻',
  // 心 & 符号
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
  '❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️',
  '✨','💫','⭐','🌟','💥','🔥','🌈','☀️','🌙','⚡',
  // 动物
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯',
  '🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅',
  // 食物
  '🍎','🍊','🍋','🍇','🍓','🍕','🍔','🌮','🍜','🍣',
  '🍦','🎂','🍰','🍩','🍪','☕','🧋','🍵','🥤','🍺',
  // 活动 & 物品
  '⚽','🏀','🏈','⚾','🎾','🏐','🎮','🎯','🎲','🃏',
  '🎁','🎈','🎉','🎊','🎀','🏆','🥇','🎵','🎶','🎸',
  '📱','💻','⌨️','🖥️','📷','📹','🎥','📺','📻','🔋',
  '💡','🔦','🕯️','🪔','🔑','🗝️','🔒','🔓','🔨','⛏️',
  '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','✈️',
  '🚀','🛸','⛵','🚢','🏠','🏡','🏢','🏣','🏤','🏥',
]

// 分组：每10个一行方便展示
</script>

<template>
  <div class="emoji-picker">
    <span
      v-for="emoji in EMOJIS"
      :key="emoji"
      class="emoji-item"
      :title="emoji"
      @click="emit('pick', emoji)"
    >{{ emoji }}</span>
  </div>
</template>

<style scoped>
.emoji-picker {
  display: flex;
  flex-wrap: wrap;
  width: 300px;
  max-height: 220px;
  overflow-y: auto;
  padding: 8px;
  gap: 2px;
  background: var(--bg-overlay);
  border-radius: 10px;
}

.emoji-picker::-webkit-scrollbar { width: 4px; }
.emoji-picker::-webkit-scrollbar-track { background: transparent; }
.emoji-picker::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.emoji-item {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 100ms;
  user-select: none;
  line-height: 1;
}
.emoji-item:hover { background: var(--bg-elevated); }
</style>
