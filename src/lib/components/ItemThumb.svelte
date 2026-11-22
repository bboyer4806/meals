<script lang="ts">
	// An item's image beside its name throughout Groceries (design 7, Item images), and a dish's
	// recipe photo beside its name on a dinner (design 7, Dinner; MEA-269). One without a photo
	// shows nothing here, so it looks as it always has.
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
