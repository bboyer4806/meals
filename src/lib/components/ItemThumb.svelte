<script lang="ts">
	// An item's image beside its name throughout Groceries (design 7, Item images). An item
	// without one shows nothing here, so it looks as it always has.
	let { photoKey, size }: { photoKey: string | null | undefined; size: number } = $props();
</script>

{#if photoKey}
	<img src="/photos/{photoKey}-thumb.jpg" alt="" width={size} height={size} loading="lazy" />
{/if}

<style>
	img {
		flex: none;
		border-radius: 8px;
		object-fit: cover;
		background: var(--surface-sunk);
	}
</style>
