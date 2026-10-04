<script lang="ts">
	import Sheet from './Sheet.svelte';

	// Asks before submitting the form it's placed in.
	let {
		label,
		message,
		confirmLabel,
		formaction,
		danger = false
	}: {
		label: string;
		message: string;
		confirmLabel: string;
		formaction?: string;
		danger?: boolean;
	} = $props();

	let open = $state(false);
</script>

<button type="button" class:danger onclick={() => (open = true)}>{label}</button>
<Sheet bind:open title={label}>
	<p>{message}</p>
	<div class="row">
		<button type="submit" class="primary" {formaction} onclick={() => (open = false)}>
			{confirmLabel}
		</button>
		<button type="button" onclick={() => (open = false)}>Cancel</button>
	</div>
</Sheet>
