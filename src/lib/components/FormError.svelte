<script lang="ts">
	// Shows the message from a failed form action, if there is one.
	let { form }: { form: { error?: string } | null | undefined } = $props();
</script>

{#if form?.error}
	<p class="error" role="alert">{form.error}</p>
{/if}
