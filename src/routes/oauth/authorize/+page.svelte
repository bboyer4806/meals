<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Connect {data.platform} · Meals</title>
</svelte:head>

<main class="page">
	<h1>Connect {data.platform} to Meals?</h1>
	<p>{data.platform} will be able to:</p>
	<ul>
		<li>
			Read every household's information: settings, members and their email addresses, stores,
			items, grocery lists and history, recipes, the menu, requests and party lists.
		</li>
		<li>Propose changes, which happen only when you approve them here in Meals.</li>
	</ul>
	<p>
		Allow it only if you just started connecting Meals from your own {data.platform}. You can
		disconnect it at any time on Admin.
	</p>
	<!-- Not enhanced: Allow and Deny send the browser back to the assistant. -->
	<form method="POST" class="row">
		{#each data.params as [name, value]}
			<input type="hidden" {name} {value} />
		{/each}
		<button class="primary" formaction="?/allow">Allow</button>
		<button formaction="?/deny">Deny</button>
	</form>
</main>
