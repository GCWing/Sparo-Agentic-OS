//! Process-local serialization between Draft authoring and lifecycle mutation.
//!
//! AppBuilder tools and publish/archive operations touch the same mutable Draft
//! tree through different entry points. They must share one lock per Draft so
//! an immutable Release can never be cut from a half-written package.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex, Weak};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

static DRAFT_LOCKS: LazyLock<Mutex<HashMap<String, Weak<AsyncMutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) async fn acquire_draft_lock(draft_id: &str) -> OwnedMutexGuard<()> {
    let lock = {
        let mut locks = DRAFT_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(draft_id).and_then(Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(AsyncMutex::new(()));
            locks.insert(draft_id.to_string(), Arc::downgrade(&lock));
            lock
        }
    };
    lock.lock_owned().await
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn the_same_draft_is_serialized() {
        let first = acquire_draft_lock("draft_serialized").await;
        assert!(tokio::time::timeout(
            Duration::from_millis(20),
            acquire_draft_lock("draft_serialized")
        )
        .await
        .is_err());
        drop(first);
        tokio::time::timeout(
            Duration::from_secs(1),
            acquire_draft_lock("draft_serialized"),
        )
        .await
        .expect("lock should be released");
    }

    #[tokio::test]
    async fn distinct_drafts_do_not_block_each_other() {
        let _first = acquire_draft_lock("draft_one").await;
        tokio::time::timeout(Duration::from_secs(1), acquire_draft_lock("draft_two"))
            .await
            .expect("distinct Drafts must not share a lock");
    }
}
