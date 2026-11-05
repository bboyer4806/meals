<script lang="ts">
	// An item's image beside its name in Groceries (MEA-50): the Items list, the grocery list, the
	// add bar's suggestions and History. Only items with an image show one. It adds nothing for
	// screen readers, since the name beside it says what the item is.
	let { photoKey, size }: { photoKey: string; size: number } = $props();
</script>

<img
	src="/photos/{photoKey}-thumb.jpg"
	alt=""
	width={size}
	height={size}
	loading="lazy"
	style:width="{size}px"
	style:height="{size}px"
/>

<style>
	img {
		flex: none;
		border-radius: 8px;
		object-fit: cover;
		background: var(--surface-sunk);
	}
</style>
